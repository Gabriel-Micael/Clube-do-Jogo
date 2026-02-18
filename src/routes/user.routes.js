module.exports = function registerUserRoutes(app, deps) {
const {
    adminEventClients,
    adminEventClientSeq: initialAdminEventClientSeq = 0,
    assertNicknameAvailable,
    avatarUpload,
    bcrypt,
    createPasswordResetForUser,
    dbAll,
    dbGet,
    dbRun,
    getLatestResolvedAdminActionForRequester,
    getPendingOwnerActionRequests,
    getProfileComments,
    getPublicBaseUrl,
    getUserProfileActivity,
    isValidEmail,
    listUserRolesForClient,
    maskEmailForDisplay,
    normalizeNickname,
    nowInSeconds,
    requireAdminAccess,
    requireAuth,
    sanitizeText,
    session,
    sha256,
    syncUserAchievements,
} = deps;
let adminEventClientSeq = Number(initialAdminEventClientSeq) || 0;

app.get("/api/user/profile", requireAuth, async (req, res) => {
    try {
        const user = await dbGet(
            `SELECT id, username, email, nickname, avatar_url
             FROM users WHERE id = ? LIMIT 1`,
            [req.session.userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        user.nickname = normalizeNickname(user.nickname, user.username);
        return res.json({
            profile: user,
            isOwner: Boolean(req.currentUser?.isOwner),
            isModerator: Boolean(req.currentUser?.isModerator)
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar perfil." });
    }
});

app.get("/api/users/roles-map", requireAuth, async (req, res) => {
    try {
        const users = await listUserRolesForClient();
        return res.json({ users });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar pap?is de usu?rios." });
    }
});

app.get("/api/users/roles", requireAuth, async (req, res) => {
    try {
        const users = await listUserRolesForClient();
        return res.json({ users });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar pap?is de usu?rios." });
    }
});

app.get("/api/admin/notification-state", requireAuth, async (req, res) => {
    try {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        if (!req.currentUser?.isOwner && !req.currentUser?.isModerator) {
            return res.status(403).json({ message: "Acesso permitido apenas para dono e moderadores." });
        }
        if (req.currentUser?.isOwner) {
            const pendingOwnerActionRequests = await getPendingOwnerActionRequests();
            return res.json({
                pendingOwnerActionCount: pendingOwnerActionRequests.length,
                pendingOwnerActionRequests,
                latestResolvedAdminAction: null
            });
        }
        const latestResolvedAdminAction = await getLatestResolvedAdminActionForRequester(req.currentUser.id);
        return res.json({
            pendingOwnerActionCount: 0,
            pendingOwnerActionRequests: [],
            latestResolvedAdminAction
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar estado de notificacoes." });
    }
});

app.get("/api/admin/events", requireAuth, requireAdminAccess, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }

    const clientId = ++adminEventClientSeq;
    const keepAliveTimer = setInterval(() => {
        try {
            res.write(": keepalive\n\n");
        } catch {
            clearInterval(keepAliveTimer);
            adminEventClients.delete(clientId);
        }
    }, 25000);

    adminEventClients.set(clientId, {
        res,
        userId: Number(req.currentUser?.id) || 0
    });
    res.write(": connected\n\n");
    res.write(`event: admin-change\ndata: ${JSON.stringify({ reason: "connected", at: nowInSeconds() })}\n\n`);

    req.on("close", () => {
        clearInterval(keepAliveTimer);
        adminEventClients.delete(clientId);
    });
});

app.get("/api/users/:userId/profile-view", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const user = await dbGet(
            `SELECT id, username, email, nickname, avatar_url
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        user.nickname = normalizeNickname(user.nickname, user.username);
        if (userId !== req.currentUser.id) {
            user.email = maskEmailForDisplay(user.email);
        }
        const activity = await getUserProfileActivity(userId);
        return res.json({
            profile: user,
            activity,
            canEdit: userId === req.currentUser.id
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar perfil." });
    }
});

app.get("/api/user/profile-view", requireAuth, async (req, res) => {
    try {
        const rawUserId = req.query.userId !== undefined ? Number(req.query.userId) : req.currentUser.id;
        const userId = Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : req.currentUser.id;
        const user = await dbGet(
            `SELECT id, username, email, nickname, avatar_url
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        user.nickname = normalizeNickname(user.nickname, user.username);
        if (userId !== req.currentUser.id) {
            user.email = maskEmailForDisplay(user.email);
        }
        const activity = await getUserProfileActivity(userId);
        return res.json({
            profile: user,
            activity,
            canEdit: userId === req.currentUser.id
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar perfil." });
    }
});

app.get("/api/user/achievements", requireAuth, async (req, res) => {
    try {
        const requestedUserId = Number(req.query.userId);
        const targetUserId =
            Number.isInteger(requestedUserId) && requestedUserId > 0
                ? requestedUserId
                : req.currentUser.id;
        const targetExists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [targetUserId]);
        if (!targetExists) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        const claimRequested =
            String(req.query.claim || "").toLowerCase() === "1"
            || String(req.query.claim || "").toLowerCase() === "true";
        const canClaim = claimRequested && targetUserId === req.currentUser.id;

        const payload = await syncUserAchievements(targetUserId, {
            markNewAsNotified: canClaim
        });
        return res.json({
            userId: targetUserId,
            canEdit: targetUserId === req.currentUser.id,
            ...payload
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar conquistas." });
    }
});

app.put("/api/user/profile", requireAuth, async (req, res) => {
    try {
        const current = await dbGet(
            "SELECT id, username, nickname FROM users WHERE id = ? LIMIT 1",
            [req.session.userId]
        );
        if (!current) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        const nickname = normalizeNickname(req.body.nickname, current.username);
        await assertNicknameAvailable(nickname, req.session.userId);

        await dbRun("UPDATE users SET nickname = ? WHERE id = ?", [
            nickname,
            req.session.userId
        ]);
        return res.json({ message: "Perfil atualizado.", profile: { nickname } });
    } catch (error) {
        console.error(error);
        if (String(error.message || "").includes("Nickname ja")) {
            return res.status(409).json({ message: error.message });
        }
        return res.status(500).json({ message: "Erro ao atualizar perfil." });
    }
});

async function handleNicknameAvailabilityRequest(req, res) {
    try {
        const current = await dbGet(
            "SELECT id, username, nickname FROM users WHERE id = ? LIMIT 1",
            [req.session.userId]
        );
        if (!current) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        const rawNickname =
            req.method === "POST"
                ? req.body?.nickname
                : req.query?.nickname;
        const requested = sanitizeText(rawNickname, 30);
        if (!requested) {
            return res.status(400).json({ message: "Informe um nickname para verificar." });
        }

        const normalized = normalizeNickname(requested, current.username);
        const currentNormalized = normalizeNickname(current.nickname, current.username);
        const sameAsCurrent = normalized.toLowerCase() === currentNormalized.toLowerCase();
        if (sameAsCurrent) {
            return res.json({
                nickname: normalized,
                available: true,
                sameAsCurrent: true,
                message: "Esse ja e o seu nickname atual."
            });
        }

        try {
            await assertNicknameAvailable(normalized, req.session.userId);
            return res.json({
                nickname: normalized,
                available: true,
                sameAsCurrent: false,
                message: "Nickname disponivel."
            });
        } catch (error) {
            if (String(error.message || "").includes("Nickname ja")) {
                return res.json({
                    nickname: normalized,
                    available: false,
                    sameAsCurrent: false,
                    message: "Nickname ja esta em uso."
                });
            }
            throw error;
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao verificar nickname." });
    }
}

app.get("/api/user/nickname-availability", requireAuth, handleNicknameAvailabilityRequest);
app.post("/api/user/nickname-availability", requireAuth, handleNicknameAvailabilityRequest);

app.post("/api/user/avatar", requireAuth, (req, res) => {
    avatarUpload.single("avatar")(req, res, async (error) => {
        try {
            if (error) {
                if (error.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({ message: "A imagem excede o limite de 12MB." });
                }
                return res.status(400).json({ message: error.message || "Erro no upload da imagem." });
            }
            if (!req.file) {
                return res.status(400).json({ message: "Envie uma imagem de perfil." });
            }
            const avatarUrl = `/uploads/avatars/${req.file.filename}`;
            await dbRun("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, req.session.userId]);
            return res.json({ message: "Avatar atualizado.", avatarUrl });
        } catch (uploadError) {
            console.error(uploadError);
            return res.status(500).json({ message: "Erro ao atualizar avatar." });
        }
    });
});
app.post("/api/user/password-reset-link", requireAuth, async (req, res) => {
    try {
        const user = await dbGet(
            "SELECT id, email FROM users WHERE id = ? LIMIT 1",
            [req.session.userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        await createPasswordResetForUser(user.id, user.email, getPublicBaseUrl(req));
        return res.json({ message: "Link de troca de senha enviado para seu email." });
    } catch (error) {
        console.error(error);
        if (String(error.message || "").includes("Falha no envio de email")) {
            return res.status(502).json({ message: error.message });
        }
        return res.status(500).json({ message: "Erro ao enviar link de troca de senha." });
    }
});

app.get("/api/users/:userId/profile-comments", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuário não encontrado." });
        const comments = await getProfileComments(userId, req.currentUser.id);
        return res.json({ comments });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar comentarios de perfil." });
    }
});

app.get("/api/user/profile-comments", requireAuth, async (req, res) => {
    try {
        const rawUserId = req.query.userId !== undefined ? Number(req.query.userId) : req.currentUser.id;
        const userId = Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : req.currentUser.id;
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuário não encontrado." });
        const comments = await getProfileComments(userId, req.currentUser.id);
        return res.json({ comments });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar comentarios de perfil." });
    }
});

app.post("/api/users/:userId/profile-comments", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const commentText = sanitizeText(req.body.commentText, 500);
        const parentCommentId = Number(req.body.parentCommentId || 0);
        if (!commentText) {
            return res.status(400).json({ message: "Comentário vazio." });
        }
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuário não encontrado." });

        let parentId = null;
        if (parentCommentId > 0) {
            const parent = await dbGet(
                `SELECT id, profile_user_id
                 FROM profile_comments
                 WHERE id = ? LIMIT 1`,
                [parentCommentId]
            );
            if (!parent || Number(parent.profile_user_id) !== userId) {
                return res.status(400).json({ message: "Coment?rio pai inv?lido para este perfil." });
            }
            parentId = Number(parent.id);
        }
        const createdAt = nowInSeconds();
        const createdInsert = await dbRun(
            `INSERT INTO profile_comments
                (profile_user_id, author_user_id, comment_text, created_at, updated_at, parent_comment_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, req.currentUser.id, commentText, createdAt, createdAt, parentId]
        );
        const created = await dbGet(
            `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    0 AS likes_count,
                    0 AS liked_by_me
             FROM profile_comments c
             JOIN users u ON u.id = c.author_user_id
             WHERE c.id = ? LIMIT 1`,
            [createdInsert.lastID]
        );
        return res.json({ message: "Comentário publicado.", comment: created });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao comentar no perfil." });
    }
});

app.post("/api/user/profile-comments", requireAuth, async (req, res) => {
    try {
        const rawUserId = req.query.userId !== undefined ? Number(req.query.userId) : req.currentUser.id;
        const userId = Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : req.currentUser.id;
        const commentText = sanitizeText(req.body.commentText, 500);
        const parentCommentId = Number(req.body.parentCommentId || 0);
        if (!commentText) {
            return res.status(400).json({ message: "Comentário vazio." });
        }
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuário não encontrado." });

        let parentId = null;
        if (parentCommentId > 0) {
            const parent = await dbGet(
                `SELECT id, profile_user_id
                 FROM profile_comments
                 WHERE id = ? LIMIT 1`,
                [parentCommentId]
            );
            if (!parent || Number(parent.profile_user_id) !== userId) {
                return res.status(400).json({ message: "Coment?rio pai inv?lido para este perfil." });
            }
            parentId = Number(parent.id);
        }
        const createdAt = nowInSeconds();
        const createdInsert = await dbRun(
            `INSERT INTO profile_comments
                (profile_user_id, author_user_id, comment_text, created_at, updated_at, parent_comment_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, req.currentUser.id, commentText, createdAt, createdAt, parentId]
        );
        const created = await dbGet(
            `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    0 AS likes_count,
                    0 AS liked_by_me
             FROM profile_comments c
             JOIN users u ON u.id = c.author_user_id
             WHERE c.id = ? LIMIT 1`,
            [createdInsert.lastID]
        );
        return res.json({ message: "Comentário publicado.", comment: created });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao comentar no perfil." });
    }
});

app.put("/api/profile-comments/:commentId", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(400).json({ message: "Coment?rio inv?lido." });
        }
        const commentText = sanitizeText(req.body.commentText, 500);
        if (!commentText) {
            return res.status(400).json({ message: "Comentário vazio." });
        }
        const existing = await dbGet(
            `SELECT id, profile_user_id, author_user_id
             FROM profile_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }
        if (Number(existing.author_user_id) !== Number(req.currentUser.id)) {
            return res.status(403).json({ message: "Você só pode editar seus próprios comentários." });
        }
        const updatedAt = nowInSeconds();
        await dbRun(
            `UPDATE profile_comments
             SET comment_text = ?, updated_at = ?
             WHERE id = ?`,
            [commentText, updatedAt, commentId]
        );
        const updated = await dbGet(
            `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    (SELECT COUNT(*) FROM profile_comment_likes l WHERE l.comment_id = c.id) AS likes_count,
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM profile_comment_likes l2
                            WHERE l2.comment_id = c.id
                              AND l2.user_id = ?
                        ) THEN 1
                        ELSE 0
                    END AS liked_by_me
             FROM profile_comments c
             JOIN users u ON u.id = c.author_user_id
             WHERE c.id = ? LIMIT 1`,
            [req.currentUser.id, commentId]
        );
        return res.json({ message: "Comentário atualizado.", comment: updated });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao atualizar comentario do perfil." });
    }
});

app.delete("/api/profile-comments/:commentId", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(400).json({ message: "Coment?rio inv?lido." });
        }
        const existing = await dbGet(
            `SELECT id, profile_user_id, author_user_id
             FROM profile_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }
        const isOwn = Number(existing.author_user_id) === Number(req.currentUser.id);
        const isProfileOwner = Number(existing.profile_user_id) === Number(req.currentUser.id);
        if (!isOwn && !isProfileOwner) {
            return res.status(403).json({ message: "Sem permissao para excluir este comentario." });
        }

        await dbRun(
            `UPDATE profile_comments
             SET parent_comment_id = NULL
             WHERE parent_comment_id = ?`,
            [commentId]
        );
        await dbRun(
            `DELETE FROM profile_comment_likes
             WHERE comment_id = ?`,
            [commentId]
        );
        await dbRun("DELETE FROM profile_comments WHERE id = ?", [commentId]);
        return res.json({ message: "Comentário removido.", commentId });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao excluir comentario do perfil." });
    }
});

app.post("/api/profile-comments/:commentId/like", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(400).json({ message: "Coment?rio inv?lido." });
        }
        const exists = await dbGet(
            `SELECT id
             FROM profile_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!exists) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }

        const existingLike = await dbGet(
            `SELECT comment_id
             FROM profile_comment_likes
             WHERE comment_id = ? AND user_id = ?
             LIMIT 1`,
            [commentId, req.currentUser.id]
        );
        let liked = false;
        if (existingLike) {
            await dbRun(
                `DELETE FROM profile_comment_likes
                 WHERE comment_id = ? AND user_id = ?`,
                [commentId, req.currentUser.id]
            );
        } else {
            liked = true;
            await dbRun(
                `INSERT OR IGNORE INTO profile_comment_likes (comment_id, user_id, created_at)
                 VALUES (?, ?, ?)`,
                [commentId, req.currentUser.id, nowInSeconds()]
            );
        }

        const countRow = await dbGet(
            `SELECT COUNT(*) AS total
             FROM profile_comment_likes
             WHERE comment_id = ?`,
            [commentId]
        );
        const likesCount = Number(countRow?.total || 0);
        const comment = await dbGet(
            `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    ? AS likes_count,
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM profile_comment_likes l2
                            WHERE l2.comment_id = c.id
                              AND l2.user_id = ?
                        ) THEN 1
                        ELSE 0
                    END AS liked_by_me
             FROM profile_comments c
             JOIN users u ON u.id = c.author_user_id
             WHERE c.id = ? LIMIT 1`,
            [likesCount, req.currentUser.id, commentId]
        );

        return res.json({
            liked,
            likesCount,
            comment
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao curtir comentario do perfil." });
    }
});

app.get("/api/profile-comments/:commentId/likes", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(400).json({ message: "Coment?rio inv?lido." });
        }
        const exists = await dbGet(
            `SELECT id
             FROM profile_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!exists) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }
        const likes = await dbAll(
            `SELECT l.user_id, u.username, u.nickname, u.avatar_url, l.created_at
             FROM profile_comment_likes l
             JOIN users u ON u.id = l.user_id
             WHERE l.comment_id = ?
             ORDER BY l.created_at DESC, COALESCE(u.nickname, u.username) COLLATE NOCASE ASC`,
            [commentId]
        );
        return res.json({ likes });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar curtidas." });
    }
});

app.post("/api/auth/request-password-reset", async (req, res) => {
    try {
        const email = sanitizeText(req.body.email, 120).toLowerCase();
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: "Email inv?lido." });
        }

        const user = await dbGet("SELECT id, email FROM users WHERE email = ? LIMIT 1", [email]);
        if (user) {
            await createPasswordResetForUser(user.id, user.email, getPublicBaseUrl(req));
        }

        return res.json({
            message: "Se o email existir na base, um link de troca de senha foi enviado."
        });
    } catch (error) {
        console.error(error);
        if (String(error.message || "").includes("Falha no envio de email")) {
            return res.status(502).json({ message: error.message });
        }
        return res.status(500).json({ message: "Erro ao solicitar troca de senha." });
    }
});

app.post("/api/auth/reset-password", async (req, res) => {
    try {
        const token = sanitizeText(req.body.token, 200);
        const password = String(req.body.password || "");
        if (!token) {
            return res.status(400).json({ message: "Token inválido." });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: "A senha precisa ter ao menos 8 caracteres." });
        }

        const tokenHash = sha256(token);
        const reset = await dbGet(
            `SELECT id, user_id, expires_at, used
             FROM password_resets
             WHERE token_hash = ? LIMIT 1`,
            [tokenHash]
        );

        if (!reset || reset.used || reset.expires_at < nowInSeconds()) {
            return res.status(400).json({ message: "Token inválido ou expirado." });
        }

        const newPasswordHash = await bcrypt.hash(password, 12);
        await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [newPasswordHash, reset.user_id]);
        await dbRun("UPDATE password_resets SET used = 1 WHERE id = ?", [reset.id]);

        return res.json({ message: "Senha alterada com sucesso." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao alterar senha." });
    }
});
};
