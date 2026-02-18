const {
    exchangeNpssoForAccessCode,
    exchangeAccessCodeForAuthTokens,
    getProfileFromAccountId,
    getUserTitles,
    getUserTrophyProfileSummary
} = require("psn-api");

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

function clampInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function parseIsoDateToSeconds(value) {
    const iso = String(value || "").trim();
    if (!iso) return 0;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

function psnProfileMessageFromError(error) {
    const raw = String(error?.message || "").trim();
    const text = raw.toLowerCase();
    if (text.includes("npsso") || text.includes("unauthorized") || text.includes("401")) {
        return "Token NPSSO invalido ou expirado.";
    }
    if (text.includes("forbidden") || text.includes("private")) {
        return "Nao foi possivel acessar os trofeus desta conta PSN. Verifique a privacidade da conta.";
    }
    if (text.includes("not found") || text.includes("404")) {
        return "Conta PSN nao encontrada.";
    }
    return "Falha ao sincronizar conquistas da PSN.";
}

function chooseBestPsnAvatar(avatarUrls = []) {
    const rows = Array.isArray(avatarUrls) ? avatarUrls : [];
    if (!rows.length) return "";
    return sanitizeText(
        rows[rows.length - 1]?.avatarUrl || rows[rows.length - 1]?.url || rows[0]?.avatarUrl || rows[0]?.url || "",
        500
    );
}

function normalizePsnTitleList(rawTitles = []) {
    const rows = Array.isArray(rawTitles) ? rawTitles : [];
    return rows
        .map((title) => {
            const npCommunicationId = sanitizeText(title?.npCommunicationId || "", 40);
            const npServiceName = sanitizeText(title?.npServiceName || "", 16) || "trophy2";
            const titleName = sanitizeText(title?.trophyTitleName || "", 140);
            if (!npCommunicationId || !titleName) return null;
            const earned = title?.earnedTrophies || {};
            const defined = title?.definedTrophies || {};
            return {
                npServiceName,
                npCommunicationId,
                titleName,
                titleIconUrl: sanitizeText(title?.trophyTitleIconUrl || "", 500),
                titlePlatform: sanitizeText(title?.trophyTitlePlatform || "", 40),
                progress: clampInt(title?.progress, 0, 100),
                earnedBronze: clampInt(earned?.bronze, 0),
                earnedSilver: clampInt(earned?.silver, 0),
                earnedGold: clampInt(earned?.gold, 0),
                earnedPlatinum: clampInt(earned?.platinum, 0),
                definedBronze: clampInt(defined?.bronze, 0),
                definedSilver: clampInt(defined?.silver, 0),
                definedGold: clampInt(defined?.gold, 0),
                definedPlatinum: clampInt(defined?.platinum, 0),
                lastUpdatedAt: parseIsoDateToSeconds(title?.lastUpdatedDateTime)
            };
        })
        .filter(Boolean);
}

async function fetchPsnSnapshot({ npsso }) {
    const npssoToken = sanitizeText(npsso, 200);
    if (!npssoToken || npssoToken.length < 20) {
        const error = new Error("Informe um token NPSSO valido.");
        error.statusCode = 400;
        throw error;
    }

    const code = await exchangeNpssoForAccessCode(npssoToken);
    const auth = await exchangeAccessCodeForAuthTokens(code);
    const authorization = { accessToken: auth.accessToken };
    const summaryResponse = await getUserTrophyProfileSummary(authorization, "me");
    const accountId = sanitizeText(summaryResponse?.accountId || "", 40);
    if (!accountId) {
        const error = new Error("Conta PSN nao encontrada.");
        error.statusCode = 404;
        throw error;
    }
    const titleResponse = await getUserTitles(authorization, "me", { limit: 80, offset: 0 });
    const profile = await getProfileFromAccountId(authorization, accountId).catch(() => null);
    const summaryEarned = summaryResponse?.earnedTrophies || {};
    const titles = normalizePsnTitleList(titleResponse?.trophyTitles || []);
    const onlineId = sanitizeText(profile?.onlineId || "", 40) || accountId;

    return {
        onlineId,
        accountId,
        avatarUrl: chooseBestPsnAvatar(profile?.avatars || []),
        trophyLevel: clampInt(summaryResponse?.trophyLevel, 0),
        trophyProgress: clampInt(summaryResponse?.progress, 0, 100),
        trophies: {
            bronze: clampInt(summaryEarned?.bronze, 0),
            silver: clampInt(summaryEarned?.silver, 0),
            gold: clampInt(summaryEarned?.gold, 0),
            platinum: clampInt(summaryEarned?.platinum, 0)
        },
        titles
    };
}

async function savePsnSnapshotForUser(userId, snapshot) {
    const now = nowInSeconds();
    await dbRun(
        `UPDATE users
         SET psn_online_id = ?,
             psn_account_id = ?,
             psn_avatar_url = ?,
             psn_trophy_level = ?,
             psn_trophy_progress = ?,
             psn_trophies_bronze = ?,
             psn_trophies_silver = ?,
             psn_trophies_gold = ?,
             psn_trophies_platinum = ?,
             psn_linked_at = CASE
                                WHEN COALESCE(psn_linked_at, 0) > 0 THEN psn_linked_at
                                ELSE ?
                             END,
             psn_updated_at = ?
         WHERE id = ?`,
        [
            sanitizeText(snapshot?.onlineId || "", 40),
            sanitizeText(snapshot?.accountId || "", 40),
            sanitizeText(snapshot?.avatarUrl || "", 500),
            clampInt(snapshot?.trophyLevel, 0),
            clampInt(snapshot?.trophyProgress, 0, 100),
            clampInt(snapshot?.trophies?.bronze, 0),
            clampInt(snapshot?.trophies?.silver, 0),
            clampInt(snapshot?.trophies?.gold, 0),
            clampInt(snapshot?.trophies?.platinum, 0),
            now,
            now,
            userId
        ]
    );

    await dbRun("DELETE FROM user_psn_titles WHERE user_id = ?", [userId]);
    for (const title of snapshot?.titles || []) {
        await dbRun(
            `INSERT INTO user_psn_titles
                (user_id, np_service_name, np_communication_id, title_name, title_icon_url, title_platform,
                 progress, earned_bronze, earned_silver, earned_gold, earned_platinum,
                 defined_bronze, defined_silver, defined_gold, defined_platinum, last_updated_at, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                sanitizeText(title?.npServiceName || "", 16),
                sanitizeText(title?.npCommunicationId || "", 40),
                sanitizeText(title?.titleName || "", 140),
                sanitizeText(title?.titleIconUrl || "", 500),
                sanitizeText(title?.titlePlatform || "", 40),
                clampInt(title?.progress, 0, 100),
                clampInt(title?.earnedBronze, 0),
                clampInt(title?.earnedSilver, 0),
                clampInt(title?.earnedGold, 0),
                clampInt(title?.earnedPlatinum, 0),
                clampInt(title?.definedBronze, 0),
                clampInt(title?.definedSilver, 0),
                clampInt(title?.definedGold, 0),
                clampInt(title?.definedPlatinum, 0),
                clampInt(title?.lastUpdatedAt, 0),
                now
            ]
        );
    }
}

async function clearPsnSnapshotForUser(userId) {
    await dbRun("DELETE FROM user_psn_titles WHERE user_id = ?", [userId]);
    await dbRun(
        `UPDATE users
         SET psn_online_id = NULL,
             psn_account_id = NULL,
             psn_avatar_url = NULL,
             psn_trophy_level = 0,
             psn_trophy_progress = 0,
             psn_trophies_bronze = 0,
             psn_trophies_silver = 0,
             psn_trophies_gold = 0,
             psn_trophies_platinum = 0,
             psn_linked_at = NULL,
             psn_updated_at = NULL
         WHERE id = ?`,
        [userId]
    );
}

async function getPsnProfileView(userId) {
    const row = await dbGet(
        `SELECT psn_online_id, psn_account_id, psn_avatar_url,
                psn_trophy_level, psn_trophy_progress,
                psn_trophies_bronze, psn_trophies_silver, psn_trophies_gold, psn_trophies_platinum,
                psn_linked_at, psn_updated_at
         FROM users
         WHERE id = ? LIMIT 1`,
        [userId]
    );
    const storedOnlineId = sanitizeText(row?.psn_online_id || "", 40);
    const storedAccountId = sanitizeText(row?.psn_account_id || "", 40);
    if (!row || (!storedOnlineId && !storedAccountId)) {
        return { linked: false };
    }

    const titles = await dbAll(
        `SELECT np_service_name, np_communication_id, title_name, title_icon_url, title_platform,
                progress, earned_bronze, earned_silver, earned_gold, earned_platinum,
                defined_bronze, defined_silver, defined_gold, defined_platinum,
                last_updated_at, synced_at
         FROM user_psn_titles
         WHERE user_id = ?
         ORDER BY progress DESC, COALESCE(last_updated_at, synced_at) DESC, title_name COLLATE NOCASE ASC
         LIMIT 60`,
        [userId]
    );

    return {
        linked: true,
        onlineId: storedOnlineId || storedAccountId,
        accountId: storedAccountId,
        avatarUrl: sanitizeText(row.psn_avatar_url || "", 500),
        linkedAt: Number(row.psn_linked_at || 0) || null,
        updatedAt: Number(row.psn_updated_at || 0) || null,
        summary: {
            level: clampInt(row.psn_trophy_level, 0),
            progress: clampInt(row.psn_trophy_progress, 0, 100),
            bronze: clampInt(row.psn_trophies_bronze, 0),
            silver: clampInt(row.psn_trophies_silver, 0),
            gold: clampInt(row.psn_trophies_gold, 0),
            platinum: clampInt(row.psn_trophies_platinum, 0)
        },
        titles: (titles || []).map((item) => ({
            npServiceName: sanitizeText(item.np_service_name || "", 16),
            npCommunicationId: sanitizeText(item.np_communication_id || "", 40),
            titleName: sanitizeText(item.title_name || "", 140),
            titleIconUrl: sanitizeText(item.title_icon_url || "", 500),
            titlePlatform: sanitizeText(item.title_platform || "", 40),
            progress: clampInt(item.progress, 0, 100),
            earnedBronze: clampInt(item.earned_bronze, 0),
            earnedSilver: clampInt(item.earned_silver, 0),
            earnedGold: clampInt(item.earned_gold, 0),
            earnedPlatinum: clampInt(item.earned_platinum, 0),
            definedBronze: clampInt(item.defined_bronze, 0),
            definedSilver: clampInt(item.defined_silver, 0),
            definedGold: clampInt(item.defined_gold, 0),
            definedPlatinum: clampInt(item.defined_platinum, 0),
            lastUpdatedAt: clampInt(item.last_updated_at, 0),
            syncedAt: clampInt(item.synced_at, 0)
        }))
    };
}

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
        const psnProfile = await getPsnProfileView(userId);
        return res.json({
            profile: user,
            activity,
            psnProfile,
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
        const psnProfile = await getPsnProfileView(userId);
        return res.json({
            profile: user,
            activity,
            psnProfile,
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

app.post("/api/user/psn/link", requireAuth, async (req, res) => {
    try {
        const npsso = sanitizeText(req.body?.npsso || "", 200);
        if (!npsso) {
            return res.status(400).json({ message: "Informe o token NPSSO." });
        }

        const snapshot = await fetchPsnSnapshot({ npsso });
        await savePsnSnapshotForUser(req.currentUser.id, snapshot);
        const psnProfile = await getPsnProfileView(req.currentUser.id);
        return res.json({
            message: "Conta PSN vinculada e conquistas sincronizadas.",
            psnProfile
        });
    } catch (error) {
        console.error("[psn-link]", error);
        const status = Number(error?.statusCode) || 502;
        return res.status(status).json({ message: psnProfileMessageFromError(error) });
    }
});

app.post("/api/user/psn/unlink", requireAuth, async (req, res) => {
    try {
        await clearPsnSnapshotForUser(req.currentUser.id);
        return res.json({ message: "Conta PSN desvinculada." });
    } catch (error) {
        console.error("[psn-unlink]", error);
        return res.status(500).json({ message: "Erro ao desvincular conta PSN." });
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
