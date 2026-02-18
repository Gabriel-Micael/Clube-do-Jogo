module.exports = function registerAdminRoutes(app, deps) {
const {
    buildRoleFlags,
    dbAll,
    dbGet,
    dbRun,
    emitAdminChange,
    executePreparedAdminAction,
    getLatestResolvedAdminActionForRequester,
    getOwnerSuggestionsList,
    getPendingAdminActionForRequester,
    getPendingOwnerActionRequests,
    nowInSeconds,
    parseJsonSafely,
    pruneExpiredAdminActionRequests,
    queueOrExecuteAdminAction,
    requireAdminAccess,
    requireAuth,
    requireOwner,
    sanitizeText,
} = deps;

app.get("/api/users", requireAuth, async (req, res) => {
    try {
        const term = sanitizeText(req.query.term || "", 60).toLowerCase();
        let rows;
        if (term) {
            rows = await dbAll(
                `SELECT id, username, nickname, avatar_url
                 FROM users
                 WHERE blocked = 0
                   AND (LOWER(username) LIKE ? OR LOWER(COALESCE(nickname, username)) LIKE ?)
                 ORDER BY COALESCE(nickname, username) COLLATE NOCASE ASC
                 LIMIT 50`,
                [`%${term}%`, `%${term}%`]
            );
        } else {
            rows = await dbAll(
                `SELECT id, username, nickname, avatar_url
                 FROM users
                 WHERE blocked = 0
                 ORDER BY COALESCE(nickname, username) COLLATE NOCASE ASC
                 LIMIT 200`
            );
        }
        return res.json({ users: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao listar usuários." });
    }
});

app.get("/api/admin/dashboard", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        await pruneExpiredAdminActionRequests();
        const usersRows = await dbAll(
            `SELECT id, username, nickname, email, blocked, created_at, is_moderator
             FROM users
             ORDER BY id DESC
             LIMIT 200`
        );
        const users = usersRows.map((user) => {
            const flags = buildRoleFlags(user);
            return {
                ...user,
                role: flags.role,
                is_owner: flags.isOwner,
                is_moderator: flags.isModerator,
                is_self: Number(user.id) === Number(req.currentUser.id)
            };
        });
        const rounds = await dbAll(
            `SELECT r.id, r.status, r.created_at, r.started_at, r.rating_starts_at, r.closed_at,
                    r.creator_user_id, u.username AS creator_username, u.nickname AS creator_nickname
             FROM rounds r
             JOIN users u ON u.id = r.creator_user_id
             ORDER BY r.id DESC
             LIMIT 200`
        );
        const userAchievements = await dbAll(
            `SELECT user_id,
                    COUNT(*) AS unlocked_count,
                    GROUP_CONCAT(achievement_key, ',') AS keys
             FROM user_achievements
             GROUP BY user_id`
        );

        const payload = { users, rounds, userAchievements };
        if (req.currentUser?.isOwner) {
            payload.pendingOwnerActionRequests = await getPendingOwnerActionRequests();
            payload.pendingOwnerActionCount = payload.pendingOwnerActionRequests.length;
            payload.ownerSuggestions = await getOwnerSuggestionsList();
        } else {
            payload.pendingAdminAction = Boolean(await getPendingAdminActionForRequester(req.currentUser.id));
            payload.latestResolvedAdminAction = await getLatestResolvedAdminActionForRequester(req.currentUser.id);
        }
        return res.json(payload);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar painel admin." });
    }
});

app.post("/api/suggestions", requireAuth, async (req, res) => {
    try {
        const targetPage = sanitizeText(req.body?.targetPage || "", 20).toLowerCase();
        const suggestionText = sanitizeText(req.body?.suggestionText || "", 1000);
        const allowedTargets = new Set(["home", "profile", "round", "admin"]);
        if (!allowedTargets.has(targetPage)) {
            return res.status(400).json({ message: "Tela da sugest?o inv?lida." });
        }
        if (targetPage === "admin" && !req.currentUser?.isOwner && !req.currentUser?.isModerator) {
            return res.status(403).json({ message: "Você não pode enviar sugestão para essa tela." });
        }
        if (suggestionText.length < 5) {
            return res.status(400).json({ message: "Digite ao menos 5 caracteres." });
        }
        await dbRun(
            `INSERT INTO suggestions (user_id, target_page, suggestion_text, created_at)
             VALUES (?, ?, ?, ?)`,
            [req.currentUser.id, targetPage, suggestionText, nowInSeconds()]
        );
        emitAdminChange("suggestion_created", {
            userId: Number(req.currentUser.id) || 0,
            targetPage
        });
        return res.json({ message: "Sugestao enviada." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao enviar sugest?o." });
    }
});

app.delete("/api/admin/suggestions/:suggestionId", requireAuth, requireOwner, async (req, res) => {
    try {
        const suggestionId = Number(req.params.suggestionId);
        if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
            return res.status(400).json({ message: "Sugest?o inv?lida." });
        }
        await dbRun("DELETE FROM suggestions WHERE id = ?", [suggestionId]);
        emitAdminChange("suggestion_deleted", {
            suggestionId
        });
        return res.json({ message: "Sugestao excluida." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao excluir sugest?o." });
    }
});

app.post("/api/admin/users/:userId/achievements", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const action = String(req.body.action || "").trim().toLowerCase();
        let actionType = "";
        if (action === "grant") actionType = "achievement_grant";
        if (action === "revoke") actionType = "achievement_revoke";
        if (action === "reset_all") actionType = "achievement_reset_all";
        if (!actionType) {
            return res.status(400).json({ message: "A??o inv?lida." });
        }
        const result = await queueOrExecuteAdminAction(req.currentUser, actionType, {
            targetUserId: userId,
            achievementKey: sanitizeText(req.body.achievementKey || "", 40)
        });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao atualizar conquistas do usu?rio." });
    }
});

app.patch("/api/admin/users/:userId/block", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const blocked = Number(req.body.blocked) === 1 ? 1 : 0;
        const result = await queueOrExecuteAdminAction(req.currentUser, "user_block", {
            targetUserId: userId,
            blocked
        });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao alterar bloqueio da conta." });
    }
});

app.delete("/api/admin/users/:userId", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const result = await queueOrExecuteAdminAction(req.currentUser, "user_delete", {
            targetUserId: userId
        });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao excluir conta." });
    }
});

app.patch("/api/admin/users/:userId/role", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const role = String(req.body.role || "").trim().toLowerCase() === "moderator" ? "moderator" : "user";
        const result = await queueOrExecuteAdminAction(req.currentUser, "set_role", {
            targetUserId: userId,
            role
        });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao alterar cargo." });
    }
});

app.patch("/api/admin/users/:userId/moderator", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const moderator = Number(req.body.moderator) === 1 || req.body.moderator === true;
        const role = moderator ? "moderator" : "user";
        const result = await queueOrExecuteAdminAction(req.currentUser, "set_role", {
            targetUserId: userId,
            role
        });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao alterar cargo." });
    }
});

app.post("/api/admin/users/:userId/moderator", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const moderator = Number(req.body.moderator) === 1 || req.body.moderator === true;
        const role = moderator ? "moderator" : "user";
        const result = await queueOrExecuteAdminAction(req.currentUser, "set_role", {
            targetUserId: userId,
            role
        });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao alterar cargo." });
    }
});

app.post("/api/admin/rounds/:roundId/close", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        if (!Number.isInteger(roundId) || roundId <= 0) {
            return res.status(400).json({ message: "Rodada inv?lida." });
        }
        const result = await queueOrExecuteAdminAction(req.currentUser, "round_close", { roundId });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao fechar rodada." });
    }
});

app.delete("/api/admin/rounds/:roundId", requireAuth, requireAdminAccess, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        if (!Number.isInteger(roundId) || roundId <= 0) {
            return res.status(400).json({ message: "Rodada inv?lida." });
        }
        const result = await queueOrExecuteAdminAction(req.currentUser, "round_delete", { roundId });
        return res.json(result);
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao excluir rodada." });
    }
});

app.post("/api/admin/action-requests/:requestId/decision", requireAuth, requireOwner, async (req, res) => {
    try {
        const requestId = Number(req.params.requestId);
        if (!Number.isInteger(requestId) || requestId <= 0) {
            return res.status(400).json({ message: "Solicita??o inv?lida." });
        }
        const decision = String(req.body?.decision || "").trim().toLowerCase();
        if (!["allow", "deny"].includes(decision)) {
            return res.status(400).json({ message: "Decis?o inv?lida." });
        }
        await pruneExpiredAdminActionRequests();
        const row = await dbGet(
            `SELECT *
             FROM admin_action_requests
             WHERE id = ? LIMIT 1`,
            [requestId]
        );
        if (!row || row.status !== "pending") {
            return res.status(404).json({ message: "Solicitação não encontrada ou já processada." });
        }

        const now = nowInSeconds();
        if (decision === "deny") {
            await dbRun(
                `UPDATE admin_action_requests
                 SET status = 'denied',
                     result_message = 'Solicitacao negada pelo dono.',
                     decided_at = ?,
                     decided_by_user_id = ?
                 WHERE id = ?`,
                [now, req.currentUser.id, requestId]
            );
            emitAdminChange("admin_action_request_decided", {
                requestId,
                decision: "deny"
            });
            return res.json({ message: "Solicitacao negada." });
        }

        const payload = parseJsonSafely(row.payload_json, {});
        try {
            const actionType = String(row.action_type || row.action_key || "");
            const result = await executePreparedAdminAction(actionType, payload, Number(req.currentUser?.id) || 0);
            await dbRun(
                `UPDATE admin_action_requests
                 SET status = 'approved',
                     result_message = ?,
                     decided_at = ?,
                     decided_by_user_id = ?
                 WHERE id = ?`,
                [sanitizeText(result?.message || "Solicitacao aprovada.", 400), now, req.currentUser.id, requestId]
            );
            emitAdminChange("admin_action_request_decided", {
                requestId,
                decision: "allow"
            });
            return res.json({ message: result?.message || "Solicitacao aprovada." });
        } catch (executeError) {
            await dbRun(
                `UPDATE admin_action_requests
                 SET status = 'denied',
                     result_message = ?,
                     decided_at = ?,
                     decided_by_user_id = ?
                 WHERE id = ?`,
                [sanitizeText(executeError?.message || "Solicitacao negada por erro na execucao.", 400), now, req.currentUser.id, requestId]
            );
            emitAdminChange("admin_action_request_decided", {
                requestId,
                decision: "deny"
            });
            const status = Number(executeError?.statusCode) || 400;
            return res.status(status).json({ message: executeError?.message || "Falha ao executar solicita??o." });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao processar solicita??o." });
    }
});
};
