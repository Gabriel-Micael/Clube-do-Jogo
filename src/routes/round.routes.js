module.exports = function registerRoundRoutes(app, deps) {
const {
    cleanupRoundPairExclusions,
    coverUpload,
    dbAll,
    dbGet,
    dbRun,
    deleteRoundCascade,
    emitRoundChange,
    emitRoundChangeForRecommendation,
    generateAssignmentsWithRotation,
    getActiveRound,
    getRawgGameDetailsByName,
    getRoundPairExclusions,
    getRoundParticipants,
    getRoundParticipantsCompact,
    getRoundPayload,
    getRoundRecommendations,
    getSteamAppDetails,
    getUserBasicById,
    isAllowedRatingLetter,
    nowInSeconds,
    requireAuth,
    requireRoundCreator,
    resolveManualGameMetadataByName,
    roundEventClients,
    roundEventClientSeq: initialRoundEventClientSeq = 0,
    sanitizeAndSavePairExclusions,
    sanitizeText,
    saveAssignments,
    searchSteamGames,
    seemsMostlyEnglishText,
    seemsPortugueseText,
    session,
    syncAchievementsForRoundParticipants,
    syncUserAchievements,
    validatePairRestrictions,
} = deps;
let roundEventClientSeq = Number(initialRoundEventClientSeq) || 0;
const epicCatalogCache = {
    loadedAt: 0,
    slugs: []
};
const EPIC_CATALOG_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const EPIC_CATALOG_SOURCE_URL = "https://erri120.github.io/egs-db/";
const EPIC_STORE_BASE_URL = "https://store.epicgames.com/en-US";

function normalizeEpicLookupToken(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
}

function buildEpicLookupCandidates(gameName) {
    const base = normalizeEpicLookupToken(gameName);
    if (!base) return [];
    const candidates = new Set([base]);
    const trimmed = base
        .replace(
            /\b(complete|ultimate|definitive|deluxe|premium|gold|goty|edition|remastered|remake|directors-cut|director-s-cut|enhanced)\b/g,
            ""
        )
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    if (trimmed) {
        candidates.add(trimmed);
    }
    const words = trimmed.split("-").filter(Boolean);
    if (words.length >= 2) {
        candidates.add(words.slice(0, 2).join("-"));
    }
    if (words.length >= 3) {
        candidates.add(words.slice(0, 3).join("-"));
    }
    return [...candidates].filter(Boolean);
}

async function loadEpicCatalogSlugs() {
    const now = Date.now();
    if (epicCatalogCache.slugs.length && (now - epicCatalogCache.loadedAt) < EPIC_CATALOG_CACHE_TTL_MS) {
        return epicCatalogCache.slugs;
    }
    const response = await fetch(EPIC_CATALOG_SOURCE_URL, {
        method: "GET",
        headers: {
            "User-Agent": "ClubeDoJogo/1.0 (+https://clubedojogo.app.br)",
            "Accept": "text/html,application/xhtml+xml"
        }
    });
    if (!response.ok) {
        throw new Error(`Epic catalog unavailable (${response.status})`);
    }
    const html = await response.text();
    const slugSet = new Set();
    const regex = /https:\/\/store\.epicgames\.com\/(?:[a-z]{2}-[A-Z]{2})\/p\/([a-z0-9-]+)/gi;
    let match = regex.exec(html);
    while (match) {
        const slug = String(match[1] || "").trim().toLowerCase();
        if (slug) slugSet.add(slug);
        match = regex.exec(html);
    }
    const slugs = [...slugSet];
    epicCatalogCache.loadedAt = now;
    epicCatalogCache.slugs = slugs;
    return slugs;
}

async function resolveEpicUrlByGameName(gameName) {
    const candidates = buildEpicLookupCandidates(gameName);
    if (!candidates.length) return "";
    let slugs = [];
    try {
        slugs = await loadEpicCatalogSlugs();
    } catch {
        return "";
    }
    if (!Array.isArray(slugs) || !slugs.length) return "";
    const slugSet = new Set(slugs);

    for (const candidate of candidates) {
        if (slugSet.has(candidate)) {
            return `${EPIC_STORE_BASE_URL}/p/${candidate}`;
        }
    }
    return "";
}

function buildEpicSearchUrl(gameName) {
    const query = sanitizeText(gameName || "", 140);
    return `${EPIC_STORE_BASE_URL}/browse?q=${encodeURIComponent(query || "jogo")}&sortBy=relevancy&sortDir=DESC&count=40`;
}

app.get("/api/rounds/active", requireAuth, async (req, res) => {
    try {
        const activeRound = await getActiveRound();
        if (!activeRound) {
            return res.json({ activeRound: null });
        }
        const payload = await getRoundPayload(activeRound.id, req.session.userId);
        return res.json({ activeRound: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar rodada ativa." });
    }
});

app.get("/api/rounds/events", requireAuth, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }

    const clientId = ++roundEventClientSeq;
    const keepAliveTimer = setInterval(() => {
        try {
            res.write(": keepalive\n\n");
        } catch {
            clearInterval(keepAliveTimer);
            roundEventClients.delete(clientId);
        }
    }, 25000);

    roundEventClients.set(clientId, {
        res,
        userId: Number(req.currentUser?.id) || 0
    });
    res.write(": connected\n\n");
    res.write(`event: round-change\ndata: ${JSON.stringify({ reason: "connected", at: nowInSeconds() })}\n\n`);

    req.on("close", () => {
        clearInterval(keepAliveTimer);
        roundEventClients.delete(clientId);
    });
});

app.get("/api/rounds/:roundId", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const payload = await getRoundPayload(roundId, req.session.userId);
        if (!payload) {
            return res.status(404).json({ message: "Rodada não encontrada." });
        }
        return res.json({ round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar rodada." });
    }
});

app.post("/api/rounds/new", requireAuth, async (req, res) => {
    try {
        const activeRound = await getActiveRound();
        if (activeRound) {
            return res.status(409).json({
                message: "Ja existe uma rodada ativa.",
                activeRoundId: activeRound.id
            });
        }

        const createdAt = nowInSeconds();
        const result = await dbRun(
            `INSERT INTO rounds (creator_user_id, status, created_at)
             VALUES (?, 'draft', ?)`,
            [req.session.userId, createdAt]
        );
        const roundId = result.lastID;
        await dbRun(
            `INSERT OR IGNORE INTO round_participants (round_id, user_id, added_at)
             VALUES (?, ?, ?)`,
            [roundId, req.session.userId, createdAt]
        );

        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_created", {
            roundId,
            status: "draft",
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Nova rodada criada.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao criar rodada." });
    }
});
app.post("/api/rounds/:roundId/participants", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const userId = Number(req.body.userId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status !== "draft") {
            return res.status(400).json({ message: "So e possivel editar participantes na fase de sorteio." });
        }

        const user = await getUserBasicById(userId);
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        await dbRun(
            `INSERT OR IGNORE INTO round_participants (round_id, user_id, added_at)
             VALUES (?, ?, ?)`,
            [roundId, userId, nowInSeconds()]
        );
        await cleanupRoundPairExclusions(roundId);

        const participants = await getRoundParticipants(roundId);
        emitRoundChange("round_participants_changed", {
            roundId,
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Participante adicionado.", participants });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao adicionar participante." });
    }
});

app.delete("/api/rounds/:roundId/participants/:userId", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const userId = Number(req.params.userId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status !== "draft") {
            return res.status(400).json({ message: "So e possivel editar participantes na fase de sorteio." });
        }
        if (round.creator_user_id === userId) {
            return res.status(400).json({ message: "O criador da rodada não pode ser removido." });
        }

        await dbRun("DELETE FROM round_participants WHERE round_id = ? AND user_id = ?", [roundId, userId]);
        await cleanupRoundPairExclusions(roundId);
        const participants = await getRoundParticipants(roundId);
        emitRoundChange("round_participants_changed", {
            roundId,
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Participante removido.", participants });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao remover participante." });
    }
});

app.put("/api/rounds/:roundId/pair-exclusions", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status !== "draft") {
            return res.status(400).json({ message: "So e possivel editar restricoes na fase de sorteio." });
        }

        const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
        await sanitizeAndSavePairExclusions(roundId, pairs);

        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_pair_exclusions_changed", {
            roundId,
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Restricoes de pares salvas.", round: payload });
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao salvar restricoes de pares." });
    }
});

app.post("/api/rounds/:roundId/draw", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status !== "draft") {
            return res.status(400).json({ message: "Esta rodada não está mais na fase de sorteio." });
        }

        const participants = await dbAll(
            "SELECT user_id FROM round_participants WHERE round_id = ? ORDER BY user_id ASC",
            [roundId]
        );
        const participantIds = participants.map((item) => item.user_id);
        if (participantIds.length < 2) {
            return res.status(400).json({ message: "Adicione ao menos 2 participantes para sortear." });
        }

        const pairExclusions = await getRoundPairExclusions(roundId);
        validatePairRestrictions(participantIds, pairExclusions);
        const assignmentMap = await generateAssignmentsWithRotation(participantIds, pairExclusions);
        await saveAssignments(roundId, assignmentMap);
        await dbRun("UPDATE rounds SET status = 'reveal', started_at = ? WHERE id = ?", [
            nowInSeconds(),
            roundId
        ]);

        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_draw_completed", {
            roundId,
            status: "reveal",
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Sorteio realizado. Agora revele os pares antes das indicações.", round: payload });
    } catch (error) {
        console.error(error);
        const status = Number(error?.statusCode) || 500;
        return res.status(status).json({ message: error.message || "Erro ao realizar sorteio." });
    }
});

app.post("/api/rounds/:roundId/reveal/:giverUserId", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const giverUserId = Number(req.params.giverUserId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status !== "reveal") {
            return res.status(400).json({ message: "A rodada não está na fase de revelação." });
        }

        await dbRun(
            "UPDATE round_assignments SET revealed = 1 WHERE round_id = ? AND giver_user_id = ?",
            [roundId, giverUserId]
        );
        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_reveal_progress", {
            roundId,
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Sorteado revelado.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao revelar sorteado." });
    }
});

app.post("/api/rounds/:roundId/start-indication", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status !== "reveal") {
            return res.status(400).json({ message: "A rodada não está pronta para iniciar indicações." });
        }

        const ratingStartsAtInput = Number(req.body.ratingStartsAt || 0);
        if (!Number.isInteger(ratingStartsAtInput) || ratingStartsAtInput <= nowInSeconds()) {
            return res.status(400).json({
                message: "Defina uma data futura para abrir a sessão de notas."
            });
        }

        await dbRun(
            "UPDATE rounds SET status = 'indication', rating_starts_at = ? WHERE id = ?",
            [ratingStartsAtInput, roundId]
        );
        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_indication_started", {
            roundId,
            status: "indication",
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({ message: "Sessão de indicações iniciada.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao iniciar sessão de indicações." });
    }
});

app.post("/api/rounds/:roundId/close", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!round) {
            return res.status(404).json({ message: "Rodada não encontrada." });
        }
        if (round.status === "closed") {
            const canReopenRound =
                Boolean(req.currentUser?.isOwner)
                || Boolean(req.currentUser?.isModerator);
            if (!canReopenRound) {
                return res.status(403).json({ message: "Sem permissao para reabrir essa rodada." });
            }
            const reopenAt = nowInSeconds();
            await dbRun(
                `UPDATE rounds
                 SET status = 'reopened',
                     rating_starts_at = ?,
                     closed_at = NULL,
                     reopened_count = COALESCE(reopened_count, 0) + 1
                 WHERE id = ?`,
                [reopenAt, roundId]
            );
            emitRoundChange("round_reopened", {
                roundId,
                status: "reopened",
                actorUserId: Number(req.currentUser?.id) || 0
            });
            const payload = await getRoundPayload(roundId, req.currentUser.id);
            return res.json({
                message: "Rodada reaberta para edição de notas navais.",
                round: payload
            });
        }

        if (round.status === "reopened") {
            const canFinalizeReopened =
                Boolean(req.currentUser?.isOwner)
                || Boolean(req.currentUser?.isModerator);
            if (!canFinalizeReopened) {
                return res.status(403).json({ message: "Sem permissao para finalizar rodada reaberta." });
            }
            await dbRun("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?", [
                nowInSeconds(),
                roundId
            ]);
            emitRoundChange("round_reopened_finalized", {
                roundId,
                status: "closed",
                actorUserId: Number(req.currentUser?.id) || 0
            });
            const payload = await getRoundPayload(roundId, req.currentUser.id);
            return res.json({ message: "Rodada reaberta finalizada.", round: payload });
        }

        const canCloseRound =
            Boolean(req.currentUser?.isOwner)
            || Number(round.creator_user_id) === Number(req.currentUser.id);
        if (!canCloseRound) {
            return res.status(403).json({ message: "Sem permissao para encerrar essa rodada." });
        }

        await dbRun("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?", [
            nowInSeconds(),
            roundId
        ]);
        await syncAchievementsForRoundParticipants(roundId);
        emitRoundChange("round_closed", {
            roundId,
            status: "closed",
            actorUserId: Number(req.currentUser?.id) || 0
        });
        const payload = await getRoundPayload(roundId, req.currentUser.id);
        return res.json({ message: "Rodada encerrada.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao encerrar rodada." });
    }
});

app.put("/api/rounds/:roundId", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!round) {
            return res.status(404).json({ message: "Rodada não encontrada." });
        }
        if (!req.currentUser?.isOwner && !req.currentUser?.isModerator && round.creator_user_id !== req.currentUser.id) {
            return res.status(403).json({ message: "Sem permissao para editar essa rodada." });
        }

        const updates = [];
        const params = [];

        if (req.body.status) {
            const allowed = new Set(["draft", "reveal", "indication", "reopened", "closed"]);
            const status = String(req.body.status);
            if (!allowed.has(status)) {
                return res.status(400).json({ message: "Status de rodada inválido." });
            }
            updates.push("status = ?");
            params.push(status);
        }

        if (req.body.ratingStartsAt !== undefined) {
            const ts = Number(req.body.ratingStartsAt);
            if (!Number.isInteger(ts) || ts <= 0) {
                return res.status(400).json({ message: "Data de notas inválida." });
            }
            updates.push("rating_starts_at = ?");
            params.push(ts);
        }

        if (!updates.length) {
            return res.status(400).json({ message: "Nada para atualizar." });
        }

        params.push(roundId);
        await dbRun(`UPDATE rounds SET ${updates.join(", ")} WHERE id = ?`, params);
        const payload = await getRoundPayload(roundId, req.currentUser.id);
        emitRoundChange("round_updated", {
            roundId,
            actorUserId: Number(req.currentUser?.id) || 0
        });
        return res.json({ message: "Rodada atualizada.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao editar rodada." });
    }
});

app.delete("/api/rounds/:roundId", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!round) return res.status(404).json({ message: "Rodada não encontrada." });
        if (!req.currentUser?.isOwner && round.creator_user_id !== req.currentUser.id) {
            return res.status(403).json({ message: "Sem permissao para excluir essa rodada." });
        }
        await deleteRoundCascade(roundId);
        emitRoundChange("round_deleted", {
            roundId,
            actorUserId: Number(req.currentUser?.id) || 0
        });
        return res.json({ message: "Rodada excluída." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao excluir rodada." });
    }
});

app.post("/api/rounds/:roundId/recommendations", requireAuth, (req, res) => {
    coverUpload.single("cover")(req, res, async (error) => {
        try {
            if (error) {
                return res.status(400).json({ message: error.message || "Erro no upload da capa." });
            }

            const roundId = Number(req.params.roundId);
            const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
            if (!round) {
                return res.status(404).json({ message: "Rodada não encontrada." });
            }
            if (round.status !== "indication") {
                return res.status(400).json({ message: "A rodada não está na fase de indicações." });
            }
            if (round.rating_starts_at && nowInSeconds() >= round.rating_starts_at) {
                return res.status(400).json({ message: "A fase de indicações encerrou. Agora a rodada está em notas." });
            }

            const assignment = await dbGet(
                "SELECT giver_user_id, receiver_user_id FROM round_assignments WHERE round_id = ? AND giver_user_id = ? LIMIT 1",
                [roundId, req.session.userId]
            );
            if (!assignment) {
                return res.status(403).json({ message: "Você não possui indicação ativa nesta rodada." });
            }

            let gameName = sanitizeText(req.body.gameName, 120);
            let gameDescription = sanitizeText(req.body.gameDescription, 500);
            const reason = sanitizeText(req.body.reason, 500);
            const steamAppId = sanitizeText(req.body.steamAppId, 20);
            const coverUrlFromBody = sanitizeText(req.body.coverUrl, 400);

            const existing = await dbGet(
                `SELECT id, game_cover_url, game_genres, game_release_year
                 FROM recommendations
                 WHERE round_id = ? AND giver_user_id = ? LIMIT 1`,
                [roundId, req.session.userId]
            );
            const isUpdate = Boolean(existing);

            let gameCoverUrl = coverUrlFromBody || "";
            if (req.file) {
                gameCoverUrl = `/uploads/covers/${req.file.filename}`;
            }

            let steamDetails = null;
            if (steamAppId) {
                steamDetails = await getSteamAppDetails(steamAppId);
            } else if (gameName) {
                steamDetails = await resolveManualGameMetadataByName(gameName);
            }
            if (steamDetails && (!gameName || !gameDescription || !gameCoverUrl)) {
                if (!gameName) {
                    gameName = sanitizeText(steamDetails?.name || "", 120);
                }
                if (!gameDescription) {
                    gameDescription = sanitizeText(steamDetails?.description || "", 500);
                }
                if (!gameCoverUrl) {
                    gameCoverUrl = sanitizeText(
                        steamDetails?.headerImage || steamDetails?.libraryImage || "",
                        400
                    );
                }
            }

            // Se a descricao vier em ingles, tenta substituir por uma descricao em portugues via RAWG.
            if (gameName && gameDescription && seemsMostlyEnglishText(gameDescription)) {
                const rawgDetails = await getRawgGameDetailsByName(gameName);
                const rawgDescription = sanitizeText(rawgDetails?.description || "", 500);
                if (rawgDescription && seemsPortugueseText(rawgDescription)) {
                    gameDescription = rawgDescription;
                }
                if (!steamDetails && rawgDetails) {
                    steamDetails = rawgDetails;
                }
            }

            if (!gameCoverUrl && /^\d+$/.test(steamAppId)) {
                gameCoverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
            }
            if (!gameDescription && steamAppId && gameName) {
                gameDescription = sanitizeText("Descrição curta indisponível na Steam.", 500);
            }

            if (!gameName) {
                return res.status(400).json({ message: "Informe o nome do jogo." });
            }
            if (!gameDescription) {
                return res.status(400).json({ message: "Informe uma descricao curta do jogo." });
            }

            if (!gameCoverUrl && existing?.game_cover_url) {
                gameCoverUrl = existing.game_cover_url;
            }
            if (!gameCoverUrl) {
                return res.status(400).json({ message: "Envie a capa do jogo (arquivo ou capa da Steam)." });
            }

            const steamGenres = sanitizeText((steamDetails?.genres || []).join(", "), 2000);
            const steamReleaseYear = Number(steamDetails?.releaseYear || 0);
            const resolvedGenres = steamGenres || sanitizeText(existing?.game_genres || "", 2000) || null;
            const resolvedReleaseYear =
                steamReleaseYear > 0
                    ? steamReleaseYear
                    : (Number(existing?.game_release_year || 0) > 0 ? Number(existing?.game_release_year) : null);
            const resolvedSteamAppId = steamAppId || (steamDetails?.appId ? String(steamDetails.appId) : null);

            if (existing) {
                await dbRun(
                    `UPDATE recommendations
                     SET receiver_user_id = ?, game_name = ?, game_cover_url = ?, game_description = ?,
                         reason = ?, steam_app_id = ?, game_genres = ?, game_release_year = ?, updated_at = ?
                     WHERE id = ?`,
                    [
                        assignment.receiver_user_id,
                        gameName,
                        gameCoverUrl,
                        gameDescription,
                        reason,
                        resolvedSteamAppId,
                        resolvedGenres,
                        resolvedReleaseYear,
                        nowInSeconds(),
                        existing.id
                    ]
                );
            } else {
                const now = nowInSeconds();
                await dbRun(
                    `INSERT INTO recommendations
                        (round_id, giver_user_id, receiver_user_id, game_name, game_cover_url, game_description,
                         reason, rating_letter, interest_score, steam_app_id, game_genres, game_release_year, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        roundId,
                        req.session.userId,
                        assignment.receiver_user_id,
                        gameName,
                        gameCoverUrl,
                        gameDescription,
                        reason,
                        "J",
                        1,
                        resolvedSteamAppId,
                        resolvedGenres,
                        resolvedReleaseYear,
                        now,
                        now
                    ]
                );
            }

            let newlyUnlocked = [];
            try {
                const achievementPayload = await syncUserAchievements(req.session.userId, {
                    markNewAsNotified: true
                });
                newlyUnlocked = achievementPayload?.newlyUnlocked || [];
            } catch (achievementError) {
                console.error("[achievement-sync-on-recommendation]", achievementError);
            }

            const payload = await getRoundPayload(roundId, req.session.userId);
            emitRoundChange("recommendation_saved", {
                roundId,
                actorUserId: Number(req.session.userId) || 0
            });
            return res.json({
                message: isUpdate ? "Indicação atualizada com sucesso." : "Indicação salva com sucesso.",
                round: payload,
                newlyUnlocked
            });
        } catch (submitError) {
            console.error(submitError);
            return res.status(500).json({ message: "Erro ao salvar indicação." });
        }
    });
});

app.post("/api/rounds/:roundId/ratings", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const recommendationId = Number(req.body.recommendationId);
        const ratingLetter = sanitizeText(req.body.ratingLetter, 1).toUpperCase();
        const interestScore = Number(req.body.interestScore);

        if (!isAllowedRatingLetter(ratingLetter)) {
            return res.status(400).json({ message: "A nota naval deve estar entre A e J." });
        }
        if (!Number.isInteger(interestScore) || interestScore < 1 || interestScore > 10) {
            return res.status(400).json({ message: "A nota de interesse deve ser de 1 a 10." });
        }

        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        const roundStatus = String(round?.status || "");
        const canRateInRound = round && (roundStatus === "indication" || roundStatus === "reopened");
        if (!canRateInRound) {
            return res.status(400).json({ message: "A rodada não está na fase de notas." });
        }
        if (roundStatus !== "reopened" && (!round.rating_starts_at || nowInSeconds() < round.rating_starts_at)) {
            return res.status(400).json({ message: "A sessão de notas ainda não foi liberada." });
        }

        const recommendation = await dbGet(
            "SELECT id, receiver_user_id FROM recommendations WHERE id = ? AND round_id = ? LIMIT 1",
            [recommendationId, roundId]
        );
        if (!recommendation) {
            return res.status(404).json({ message: "Indicação não encontrada para esta rodada." });
        }
        if (recommendation.receiver_user_id !== req.session.userId) {
            return res.status(403).json({ message: "Apenas quem recebeu a indicação pode dar a nota naval." });
        }

        const existing = await dbGet(
            "SELECT id FROM recommendation_ratings WHERE recommendation_id = ? LIMIT 1",
            [recommendationId]
        );
        const now = nowInSeconds();
        if (existing) {
            await dbRun(
                `UPDATE recommendation_ratings
                 SET rating_letter = ?, interest_score = ?, updated_at = ?, rater_user_id = ?
                 WHERE id = ?`,
                [ratingLetter, interestScore, now, req.session.userId, existing.id]
            );
        } else {
            await dbRun(
                `INSERT INTO recommendation_ratings
                    (recommendation_id, rater_user_id, rating_letter, interest_score, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [recommendationId, req.session.userId, ratingLetter, interestScore, now, now]
            );
        }

        // CGNewba: desbloqueio imediato ao avaliar uma indicação.
        await dbRun(
            `INSERT OR IGNORE INTO user_achievements (user_id, achievement_key, unlocked_at)
             VALUES (?, 'CGNewba', ?)`,
            [req.session.userId, now]
        );

        let newlyUnlocked = [];
        try {
            const achievementPayload = await syncUserAchievements(req.session.userId, {
                markNewAsNotified: true
            });
            newlyUnlocked = achievementPayload?.newlyUnlocked || [];
        } catch (achievementError) {
            console.error("[achievement-sync-on-rating]", achievementError);
        }

        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_rating_saved", {
            roundId,
            recommendationId,
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({
            message: "Nota naval registrada.",
            round: payload,
            newlyUnlocked
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao registrar nota naval." });
    }
});

app.delete("/api/rounds/:roundId/ratings", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const recommendationId = Number(req.body?.recommendationId);
        if (!Number.isInteger(recommendationId) || recommendationId <= 0) {
            return res.status(400).json({ message: "Indicação inválida para limpar o voto." });
        }

        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        const roundStatus = String(round?.status || "");
        const canRateInRound = round && (roundStatus === "indication" || roundStatus === "reopened");
        if (!canRateInRound) {
            return res.status(400).json({ message: "A rodada não está na fase de notas." });
        }
        if (roundStatus !== "reopened" && (!round.rating_starts_at || nowInSeconds() < round.rating_starts_at)) {
            return res.status(400).json({ message: "A sessão de notas ainda não foi liberada." });
        }

        const recommendation = await dbGet(
            "SELECT id, receiver_user_id FROM recommendations WHERE id = ? AND round_id = ? LIMIT 1",
            [recommendationId, roundId]
        );
        if (!recommendation) {
            return res.status(404).json({ message: "Indicação não encontrada para esta rodada." });
        }
        if (recommendation.receiver_user_id !== req.session.userId) {
            return res.status(403).json({ message: "Apenas quem recebeu a indicação pode limpar a nota naval." });
        }

        const existing = await dbGet(
            "SELECT id FROM recommendation_ratings WHERE recommendation_id = ? LIMIT 1",
            [recommendationId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Esta indicação ainda não possui nota naval registrada." });
        }

        await dbRun("DELETE FROM recommendation_ratings WHERE id = ?", [existing.id]);
        const payload = await getRoundPayload(roundId, req.session.userId);
        emitRoundChange("round_rating_cleared", {
            roundId,
            recommendationId,
            actorUserId: Number(req.session.userId) || 0
        });
        return res.json({
            message: "Nota naval removida.",
            round: payload
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao limpar nota naval." });
    }
});

app.post("/api/recommendations/:recommendationId/comments", requireAuth, async (req, res) => {
    try {
        const recommendationId = Number(req.params.recommendationId);
        const commentText = sanitizeText(req.body.commentText, 500);
        const parentCommentId = Number(req.body.parentCommentId || 0);
        if (!commentText) {
            return res.status(400).json({ message: "Comentário vazio." });
        }

        const recommendation = await dbGet(
            "SELECT id FROM recommendations WHERE id = ? LIMIT 1",
            [recommendationId]
        );
        if (!recommendation) {
            return res.status(404).json({ message: "Indicação não encontrada." });
        }

        let parentId = null;
        if (parentCommentId > 0) {
            const parent = await dbGet(
                `SELECT id, recommendation_id
                 FROM recommendation_comments
                 WHERE id = ? LIMIT 1`,
                [parentCommentId]
            );
            if (!parent || Number(parent.recommendation_id) !== recommendationId) {
                return res.status(400).json({ message: "Comentário pai inválido para esta indicação." });
            }
            parentId = parent.id;
        }

        const createdAt = nowInSeconds();
        const insert = await dbRun(
            `INSERT INTO recommendation_comments
                (recommendation_id, user_id, comment_text, created_at, updated_at, parent_comment_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [recommendationId, req.session.userId, commentText, createdAt, createdAt, parentId]
        );
        const created = await dbGet(
            `SELECT c.id, c.recommendation_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    0 AS likes_count,
                    0 AS liked_by_me
             FROM recommendation_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.id = ? LIMIT 1`,
            [insert.lastID]
        );

        await emitRoundChangeForRecommendation("recommendation_comment_changed", recommendationId, {
            actorUserId: Number(req.session.userId) || 0
        });

        return res.json({ message: "Comentário publicado.", comment: created });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao comentar." });
    }
});

app.put("/api/recommendation-comments/:commentId", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        const commentText = sanitizeText(req.body.commentText, 500);
        if (!commentText) {
            return res.status(400).json({ message: "Comentário vazio." });
        }
        const existing = await dbGet(
            `SELECT id, user_id
             FROM recommendation_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }
        if (Number(existing.user_id) !== Number(req.currentUser.id)) {
            return res.status(403).json({ message: "Você só pode editar seus próprios comentários." });
        }
        const now = nowInSeconds();
        await dbRun(
            `UPDATE recommendation_comments
             SET comment_text = ?, updated_at = ?
             WHERE id = ?`,
            [commentText, now, commentId]
        );
        const updated = await dbGet(
            `SELECT c.id, c.recommendation_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    (SELECT COUNT(*) FROM recommendation_comment_likes l WHERE l.comment_id = c.id) AS likes_count,
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM recommendation_comment_likes l2
                            WHERE l2.comment_id = c.id
                              AND l2.user_id = ?
                        ) THEN 1
                        ELSE 0
                    END AS liked_by_me
             FROM recommendation_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.id = ? LIMIT 1`,
            [req.currentUser.id, commentId]
        );
        await emitRoundChangeForRecommendation(
            "recommendation_comment_changed",
            Number(updated?.recommendation_id || 0),
            { actorUserId: Number(req.currentUser?.id) || 0 }
        );
        return res.json({ message: "Comentário atualizado.", comment: updated });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao atualizar comentário." });
    }
});

app.delete("/api/recommendation-comments/:commentId", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        const existing = await dbGet(
            `SELECT id, user_id, recommendation_id
             FROM recommendation_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }
        const isOwnComment = Number(existing.user_id) === Number(req.currentUser.id);
        if (!isOwnComment && !req.currentUser?.isOwner) {
            return res.status(403).json({ message: "Sem permissao para excluir este comentario." });
        }
        await dbRun(
            `UPDATE recommendation_comments
             SET parent_comment_id = NULL
             WHERE parent_comment_id = ?`,
            [commentId]
        );
        await dbRun(
            `DELETE FROM recommendation_comment_likes
             WHERE comment_id = ?`,
            [commentId]
        );
        await dbRun("DELETE FROM recommendation_comments WHERE id = ?", [commentId]);
        await emitRoundChangeForRecommendation(
            "recommendation_comment_changed",
            Number(existing?.recommendation_id || 0),
            { actorUserId: Number(req.currentUser?.id) || 0 }
        );
        return res.json({ message: "Comentário removido.", commentId });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao excluir comentário." });
    }
});

app.post("/api/recommendation-comments/:commentId/like", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(400).json({ message: "Comentário inválido." });
        }
        const commentExists = await dbGet(
            `SELECT id, recommendation_id
             FROM recommendation_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!commentExists) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }

        const existingLike = await dbGet(
            `SELECT comment_id
             FROM recommendation_comment_likes
             WHERE comment_id = ? AND user_id = ?
             LIMIT 1`,
            [commentId, req.currentUser.id]
        );

        let liked = false;
        if (existingLike) {
            await dbRun(
                `DELETE FROM recommendation_comment_likes
                 WHERE comment_id = ? AND user_id = ?`,
                [commentId, req.currentUser.id]
            );
        } else {
            liked = true;
            await dbRun(
                `INSERT OR IGNORE INTO recommendation_comment_likes (comment_id, user_id, created_at)
                 VALUES (?, ?, ?)`,
                [commentId, req.currentUser.id, nowInSeconds()]
            );
        }

        const countRow = await dbGet(
            `SELECT COUNT(*) AS total
             FROM recommendation_comment_likes
             WHERE comment_id = ?`,
            [commentId]
        );
        const likesCount = Number(countRow?.total || 0);
        const comment = await dbGet(
            `SELECT c.id, c.recommendation_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url,
                    ? AS likes_count,
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM recommendation_comment_likes l2
                            WHERE l2.comment_id = c.id
                              AND l2.user_id = ?
                        ) THEN 1
                        ELSE 0
                    END AS liked_by_me
             FROM recommendation_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.id = ? LIMIT 1`,
            [likesCount, req.currentUser.id, commentId]
        );

        await emitRoundChangeForRecommendation(
            "recommendation_comment_liked",
            Number(commentExists?.recommendation_id || comment?.recommendation_id || 0),
            { actorUserId: Number(req.currentUser?.id) || 0 }
        );

        return res.json({
            liked,
            likesCount,
            comment
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao curtir comentário." });
    }
});

app.get("/api/recommendation-comments/:commentId/likes", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        if (!Number.isInteger(commentId) || commentId <= 0) {
            return res.status(400).json({ message: "Comentário inválido." });
        }
        const commentExists = await dbGet(
            `SELECT id
             FROM recommendation_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!commentExists) {
            return res.status(404).json({ message: "Comentário não encontrado." });
        }
        const likes = await dbAll(
            `SELECT l.user_id, u.username, u.nickname, u.avatar_url, l.created_at
             FROM recommendation_comment_likes l
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

app.get("/api/feed/rounds", requireAuth, async (req, res) => {
    try {
        const limit = Math.min(10, Math.max(1, Number(req.query.limit || 6)));
        const rounds = await dbAll(
            `SELECT r.id, r.status, r.created_at, r.started_at, r.closed_at,
                    r.creator_user_id, u.username AS creator_username, u.nickname AS creator_nickname
             FROM rounds r
             JOIN users u ON u.id = r.creator_user_id
             WHERE EXISTS (SELECT 1 FROM recommendations rec WHERE rec.round_id = r.id)
             ORDER BY r.id DESC
             LIMIT ?`,
            [limit]
        );

        const result = [];
        for (const round of rounds) {
            const recommendations = await getRoundRecommendations(round.id, req.currentUser.id);
            let participants = await getRoundParticipantsCompact(round.id);
            if (!participants.length && recommendations.length) {
                const byId = new Map();
                for (const rec of recommendations) {
                    if (!byId.has(rec.giver_user_id)) {
                        byId.set(rec.giver_user_id, {
                            id: rec.giver_user_id,
                            username: rec.giver_username,
                            nickname: rec.giver_nickname
                        });
                    }
                    if (!byId.has(rec.receiver_user_id)) {
                        byId.set(rec.receiver_user_id, {
                            id: rec.receiver_user_id,
                            username: rec.receiver_username,
                            nickname: rec.receiver_nickname
                        });
                    }
                }
                participants = [...byId.values()].sort((a, b) =>
                    String(a.nickname || a.username || "").localeCompare(
                        String(b.nickname || b.username || ""),
                        "pt-BR"
                    )
                );
            }
            result.push({
                ...round,
                participants,
                recommendations
            });
        }
        return res.json({ rounds: result });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar feed de rodadas." });
    }
});

app.get("/api/steam/search", requireAuth, async (req, res) => {
    try {
        const term = sanitizeText(req.query.term || "", 120);
        if (term.length < 2) {
            return res.json({ items: [] });
        }
        const items = await searchSteamGames(term, 5);
        return res.json({ items });
    } catch (error) {
        console.error(error);
        return res.json({ items: [], message: "Busca Steam temporariamente indisponivel." });
    }
});

app.get("/api/steam/app/:appId", requireAuth, async (req, res) => {
    try {
        const details = await getSteamAppDetails(req.params.appId);
        if (!details) {
            return res.status(404).json({ message: "Jogo não encontrado na Steam." });
        }
        return res.json({ item: details });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar detalhes do jogo." });
    }
});

app.get("/api/epic/resolve-redirect", requireAuth, async (req, res) => {
    try {
        const term = sanitizeText(req.query.term || "", 140);
        const googleFallback = `https://www.google.com/search?q=${encodeURIComponent(term || "jogo")}`;
        if (!term) {
            return res.redirect(302, googleFallback);
        }
        const epicUrl = await resolveEpicUrlByGameName(term);
        if (epicUrl) {
            return res.redirect(302, epicUrl);
        }
        return res.redirect(302, buildEpicSearchUrl(term));
    } catch (error) {
        console.error("[epic-resolve-redirect]", error);
        const term = sanitizeText(req.query.term || "", 140);
        return res.redirect(302, buildEpicSearchUrl(term));
    }
});
};
