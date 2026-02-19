const {
    exchangeNpssoForAccessCode,
    exchangeAccessCodeForAuthTokens,
    exchangeRefreshTokenForAuthTokens,
    getProfileFromAccountId,
    getTitleTrophies,
    getUserTitles,
    getUserTrophiesEarnedForTitle,
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
const SONY_SSOCOOKIE_URL = "https://ca.account.sony.com/api/v1/ssocookie";

function clampInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function parsePaginationParams(query = {}, { defaultPage = 1, defaultPageSize = 10, maxPageSize = 50 } = {}) {
    const page = clampInt(query?.page, 1);
    const pageSize = clampInt(query?.pageSize, 1, maxPageSize) || defaultPageSize;
    return {
        page: page > 0 ? page : defaultPage,
        pageSize: pageSize > 0 ? pageSize : defaultPageSize
    };
}

function parseIsoDateToSeconds(value) {
    const iso = String(value || "").trim();
    if (!iso) return 0;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

function safeJsonParse(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function normalizeNpssoValue(rawValue) {
    return String(rawValue || "")
        .trim()
        .replace(/^"+|"+$/g, "")
        .slice(0, 200);
}

function extractNpssoFromRaw(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) return "";
    const direct = normalizeNpssoValue(raw);
    if (direct && !direct.includes("{") && !direct.includes("}")) {
        return direct;
    }

    const parsed = safeJsonParse(raw);
    const fromJson = normalizeNpssoValue(parsed?.npsso || "");
    if (fromJson) return fromJson;

    const jsonMatch = raw.match(/"npsso"\s*:\s*"([^"]+)"/i);
    if (jsonMatch?.[1]) {
        return normalizeNpssoValue(jsonMatch[1]);
    }

    const queryMatch = raw.match(/[?&]npsso=([^&\s]+)/i);
    if (queryMatch?.[1]) {
        return normalizeNpssoValue(decodeURIComponent(queryMatch[1]));
    }

    return "";
}

function getPsnAutoNpssoFailure(rawStatusCode, rawBody) {
    const statusCode = Number(rawStatusCode) || 0;
    const bodyText = String(rawBody || "").trim().toLowerCase();
    if (statusCode === 403) {
        return {
            reason: "sony_forbidden",
            message:
                "A Sony bloqueou a leitura automática do NPSSO neste contexto. Continue com o token manual."
        };
    }
    if (statusCode === 400 && (bodyText.includes("invalid_grant") || bodyText.includes("invalid login"))) {
        return {
            reason: "sony_not_logged",
            message:
                "Não foi possível obter o NPSSO automaticamente. Faça login na conta PlayStation e informe o token manualmente."
        };
    }
    return {
        reason: "sony_unavailable",
        message: "Não foi possível obter o NPSSO automaticamente no momento."
    };
}

async function tryReadNpssoFromSonyCookieEndpoint() {
    const response = await fetch(SONY_SSOCOOKIE_URL, {
        method: "GET",
        headers: { Accept: "application/json" }
    });
    const rawBody = await response.text().catch(() => "");
    const parsedBody = safeJsonParse(rawBody);
    const npsso = extractNpssoFromRaw(parsedBody?.npsso || rawBody);
    if (response.ok && npsso) {
        return {
            ok: true,
            npsso,
            reason: "ok",
            message: ""
        };
    }
    return {
        ok: false,
        npsso: "",
        ...getPsnAutoNpssoFailure(response.status, rawBody)
    };
}

function psnProfileMessageFromError(error) {
    const raw = String(error?.message || "").trim();
    const text = raw.toLowerCase();
    if (text.includes("npsso") || text.includes("unauthorized") || text.includes("401")) {
        return "Token NPSSO inválido ou expirado.";
    }
    if (text.includes("forbidden") || text.includes("private")) {
        return "Não foi possível acessar os troféus desta conta PSN. Verifique a privacidade da conta.";
    }
    if (text.includes("not found") || text.includes("404")) {
        return "Conta PSN não encontrada.";
    }
    return "Falha ao sincronizar conquistas da PSN.";
}

function psnTitleDetailsMessageFromError(error) {
    const raw = String(error?.message || "").trim();
    const text = raw.toLowerCase();
    if (text.includes("refresh") || text.includes("invalid_grant") || text.includes("unauthorized") || text.includes("401")) {
        return "Sessão PSN expirada neste perfil. Peça para o dono vincular a conta PSN novamente.";
    }
    if (text.includes("forbidden") || text.includes("private")) {
        return "Não foi possível acessar os troféus desta conta PSN. Verifique a privacidade da conta.";
    }
    if (text.includes("not found") || text.includes("404")) {
        return "Título de troféus não encontrado para este perfil.";
    }
    return "Falha ao carregar detalhes dos troféus da PSN.";
}

function normalizePsnTrophyType(rawType) {
    const type = String(rawType || "").trim().toLowerCase();
    if (type === "platinum" || type === "gold" || type === "silver" || type === "bronze") return type;
    return "bronze";
}

function parsePsnTrophyTier(rawType) {
    const type = String(rawType || "").trim().toLowerCase();
    if (type === "platinum" || type === "gold" || type === "silver" || type === "bronze") return type;
    return "";
}

function psnTierLabelFromType(tier) {
    const normalized = normalizePsnTrophyType(tier);
    if (normalized === "platinum") return "Platina";
    if (normalized === "gold") return "Ouro";
    if (normalized === "silver") return "Prata";
    return "Bronze";
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
        const error = new Error("Conta PSN não encontrada.");
        error.statusCode = 404;
        throw error;
    }
    let titles = [];
    try {
        titles = await fetchAllPsnTitlesFromApi(authorization);
    } catch {
        const titleResponse = await getUserTitles(authorization, "me", { limit: 80, offset: 0 });
        titles = normalizePsnTitleList(titleResponse?.trophyTitles || []);
    }
    const profile = await getProfileFromAccountId(authorization, accountId).catch(() => null);
    const summaryEarned = summaryResponse?.earnedTrophies || {};
    const onlineId = sanitizeText(profile?.onlineId || "", 40) || accountId;
    const refreshToken = sanitizeText(auth?.refreshToken || "", 2048);
    const refreshTokenExpiresIn = clampInt(auth?.refreshTokenExpiresIn, 0);
    const refreshTokenExpiresAt = refreshTokenExpiresIn > 0
        ? nowInSeconds() + refreshTokenExpiresIn
        : 0;

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
        titles,
        auth: {
            refreshToken,
            refreshTokenExpiresAt
        }
    };
}

function mapStoredPsnTitleRowToView(item) {
    return {
        npServiceName: sanitizeText(item?.np_service_name || "", 16),
        npCommunicationId: sanitizeText(item?.np_communication_id || "", 40),
        titleName: sanitizeText(item?.title_name || "", 140),
        titleIconUrl: sanitizeText(item?.title_icon_url || "", 500),
        titlePlatform: sanitizeText(item?.title_platform || "", 40),
        progress: clampInt(item?.progress, 0, 100),
        earnedBronze: clampInt(item?.earned_bronze, 0),
        earnedSilver: clampInt(item?.earned_silver, 0),
        earnedGold: clampInt(item?.earned_gold, 0),
        earnedPlatinum: clampInt(item?.earned_platinum, 0),
        definedBronze: clampInt(item?.defined_bronze, 0),
        definedSilver: clampInt(item?.defined_silver, 0),
        definedGold: clampInt(item?.defined_gold, 0),
        definedPlatinum: clampInt(item?.defined_platinum, 0),
        lastUpdatedAt: clampInt(item?.last_updated_at, 0),
        syncedAt: clampInt(item?.synced_at, 0)
    };
}

function mapApiPsnTitleToView(item, syncedAt = 0) {
    return {
        npServiceName: sanitizeText(item?.npServiceName || "", 16),
        npCommunicationId: sanitizeText(item?.npCommunicationId || "", 40),
        titleName: sanitizeText(item?.titleName || "", 140),
        titleIconUrl: sanitizeText(item?.titleIconUrl || "", 500),
        titlePlatform: sanitizeText(item?.titlePlatform || "", 40),
        progress: clampInt(item?.progress, 0, 100),
        earnedBronze: clampInt(item?.earnedBronze, 0),
        earnedSilver: clampInt(item?.earnedSilver, 0),
        earnedGold: clampInt(item?.earnedGold, 0),
        earnedPlatinum: clampInt(item?.earnedPlatinum, 0),
        definedBronze: clampInt(item?.definedBronze, 0),
        definedSilver: clampInt(item?.definedSilver, 0),
        definedGold: clampInt(item?.definedGold, 0),
        definedPlatinum: clampInt(item?.definedPlatinum, 0),
        lastUpdatedAt: clampInt(item?.lastUpdatedAt, 0),
        syncedAt: clampInt(syncedAt, 0)
    };
}

function sumStoredPsnPlatinumTotal(titles = []) {
    const rows = Array.isArray(titles) ? titles : [];
    return rows.reduce((acc, item) => acc + clampInt(item?.earnedPlatinum, 0), 0);
}

function shouldRefreshPsnTitlesFromApi(summary, titles = []) {
    const expectedPlatinum = clampInt(summary?.platinum, 0);
    if (expectedPlatinum <= 0) return false;
    const storedPlatinum = sumStoredPsnPlatinumTotal(titles);
    return expectedPlatinum > storedPlatinum;
}

async function replacePsnTitlesForUser(userId, titles = [], syncedAt = nowInSeconds()) {
    const normalizedSyncedAt = clampInt(syncedAt, 0);
    await dbRun("DELETE FROM user_psn_titles WHERE user_id = ?", [userId]);
    for (const title of Array.isArray(titles) ? titles : []) {
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
                normalizedSyncedAt
            ]
        );
    }
}

async function savePsnSnapshotForUser(userId, snapshot) {
    const now = nowInSeconds();
    const refreshToken = sanitizeText(snapshot?.auth?.refreshToken || "", 2048);
    const refreshTokenExpiresAt = clampInt(snapshot?.auth?.refreshTokenExpiresAt, 0);
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
             psn_refresh_token = ?,
             psn_refresh_expires_at = ?,
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
            refreshToken || null,
            refreshTokenExpiresAt > 0 ? refreshTokenExpiresAt : null,
            now,
            userId
        ]
    );

    await replacePsnTitlesForUser(userId, snapshot?.titles || [], now);
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
             psn_refresh_token = NULL,
             psn_refresh_expires_at = NULL,
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

    const summary = {
        level: clampInt(row.psn_trophy_level, 0),
        progress: clampInt(row.psn_trophy_progress, 0, 100),
        bronze: clampInt(row.psn_trophies_bronze, 0),
        silver: clampInt(row.psn_trophies_silver, 0),
        gold: clampInt(row.psn_trophies_gold, 0),
        platinum: clampInt(row.psn_trophies_platinum, 0)
    };

    const titleRows = await dbAll(
        `SELECT np_service_name, np_communication_id, title_name, title_icon_url, title_platform,
                progress, earned_bronze, earned_silver, earned_gold, earned_platinum,
                defined_bronze, defined_silver, defined_gold, defined_platinum,
                last_updated_at, synced_at
         FROM user_psn_titles
         WHERE user_id = ?
         ORDER BY COALESCE(last_updated_at, synced_at) DESC, title_name COLLATE NOCASE ASC`,
        [userId]
    );
    let titles = (titleRows || []).map(mapStoredPsnTitleRowToView);

    if (shouldRefreshPsnTitlesFromApi(summary, titles)) {
        try {
            const { authorization } = await getPsnAuthorizationForUser(userId);
            const refreshedTitles = await fetchAllPsnTitlesFromApi(authorization);
            if (Array.isArray(refreshedTitles) && refreshedTitles.length > 0) {
                const refreshedAt = nowInSeconds();
                await replacePsnTitlesForUser(userId, refreshedTitles, refreshedAt);
                titles = refreshedTitles.map((item) => mapApiPsnTitleToView(item, refreshedAt));
            }
        } catch {
            // Mantém os dados locais quando a API da PSN não estiver disponível.
        }
    }

    return {
        linked: true,
        onlineId: storedOnlineId || storedAccountId,
        accountId: storedAccountId,
        avatarUrl: sanitizeText(row.psn_avatar_url || "", 500),
        linkedAt: Number(row.psn_linked_at || 0) || null,
        updatedAt: Number(row.psn_updated_at || 0) || null,
        summary,
        titles: Array.isArray(titles) ? titles.slice(0, 10) : [],
        titlesTotal: Array.isArray(titles) ? titles.length : 0
    };
}

async function getPsnTitlesPageView(userId, { page = 1, pageSize = 10 } = {}) {
    const normalizedPage = clampInt(page, 1);
    const normalizedPageSize = clampInt(pageSize, 1, 50) || 10;

    const summaryRow = await dbGet(
        `SELECT psn_trophies_platinum
         FROM users
         WHERE id = ? LIMIT 1`,
        [userId]
    );
    const expectedPlatinum = clampInt(summaryRow?.psn_trophies_platinum, 0);
    const storedTotalsRow = await dbGet(
        `SELECT COALESCE(SUM(earned_platinum), 0) AS stored_platinum_total
         FROM user_psn_titles
         WHERE user_id = ?`,
        [userId]
    );
    const storedPlatinum = clampInt(storedTotalsRow?.stored_platinum_total, 0);
    if (expectedPlatinum > storedPlatinum) {
        try {
            const { authorization } = await getPsnAuthorizationForUser(userId);
            const refreshedTitles = await fetchAllPsnTitlesFromApi(authorization);
            if (Array.isArray(refreshedTitles) && refreshedTitles.length > 0) {
                await replacePsnTitlesForUser(userId, refreshedTitles, nowInSeconds());
            }
        } catch {
            // Mantém dados locais se não for possível atualizar agora.
        }
    }

    const countRow = await dbGet(
        `SELECT COUNT(1) AS total
         FROM user_psn_titles
         WHERE user_id = ?`,
        [userId]
    );
    const total = Math.max(0, Number(countRow?.total || 0));
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const safePage = Math.min(totalPages, normalizedPage);
    const offset = (safePage - 1) * normalizedPageSize;
    const rows = await dbAll(
        `SELECT np_service_name, np_communication_id, title_name, title_icon_url, title_platform,
                progress, earned_bronze, earned_silver, earned_gold, earned_platinum,
                defined_bronze, defined_silver, defined_gold, defined_platinum,
                last_updated_at, synced_at
         FROM user_psn_titles
         WHERE user_id = ?
         ORDER BY
            CASE WHEN COALESCE(earned_platinum, 0) > 0 THEN 1 ELSE 0 END DESC,
            COALESCE(earned_platinum, 0) DESC,
            COALESCE(progress, 0) DESC,
            COALESCE(last_updated_at, synced_at) DESC,
            title_name COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
        [userId, normalizedPageSize, offset]
    );

    return {
        page: safePage,
        pageSize: normalizedPageSize,
        total,
        totalPages,
        titles: (rows || []).map(mapStoredPsnTitleRowToView)
    };
}

function comparePsnEarnedTrophies(a, b) {
    const aEarned = clampInt(a?.earnedAt, 0);
    const bEarned = clampInt(b?.earnedAt, 0);
    if (bEarned !== aEarned) return bEarned - aEarned;
    return clampInt(a?.trophyId, 0) - clampInt(b?.trophyId, 0);
}

async function getPsnAuthorizationForUser(userId) {
    const row = await dbGet(
        `SELECT psn_online_id, psn_account_id, psn_refresh_token, psn_refresh_expires_at
         FROM users
         WHERE id = ? LIMIT 1`,
        [userId]
    );
    if (!row) {
        const error = new Error("Usuário não encontrado.");
        error.statusCode = 404;
        throw error;
    }
    const linked = Boolean(sanitizeText(row?.psn_online_id || "", 40) || sanitizeText(row?.psn_account_id || "", 40));
    if (!linked) {
        const error = new Error("Conta PSN não vinculada.");
        error.statusCode = 404;
        throw error;
    }

    const refreshToken = sanitizeText(row?.psn_refresh_token || "", 2048);
    if (!refreshToken) {
        const error = new Error("Refresh token PSN ausente. Vincule novamente.");
        error.statusCode = 409;
        throw error;
    }

    const auth = await exchangeRefreshTokenForAuthTokens(refreshToken);
    const rotatedRefreshToken = sanitizeText(auth?.refreshToken || refreshToken, 2048);
    const refreshTokenExpiresIn = clampInt(auth?.refreshTokenExpiresIn, 0);
    const refreshTokenExpiresAt = refreshTokenExpiresIn > 0
        ? nowInSeconds() + refreshTokenExpiresIn
        : clampInt(row?.psn_refresh_expires_at, 0);
    await dbRun(
        `UPDATE users
         SET psn_refresh_token = ?,
             psn_refresh_expires_at = ?
         WHERE id = ?`,
        [
            rotatedRefreshToken || null,
            refreshTokenExpiresAt > 0 ? refreshTokenExpiresAt : null,
            userId
        ]
    );

    return {
        authorization: { accessToken: String(auth?.accessToken || "") }
    };
}

async function fetchPsnEarnedTrophiesForTitle({ authorization, npServiceName, npCommunicationId }) {
    const service = sanitizeText(npServiceName, 16) || "trophy2";
    const communicationId = sanitizeText(npCommunicationId, 40);
    if (!communicationId) return [];

    const options = {
        npServiceName: service,
        limit: 800,
        offset: 0
    };
    const earnedResponse = await getUserTrophiesEarnedForTitle(
        authorization,
        "me",
        communicationId,
        "all",
        options
    );
    const earnedRows = Array.isArray(earnedResponse?.trophies)
        ? earnedResponse.trophies.filter((item) => Boolean(item?.earned))
        : [];
    if (!earnedRows.length) return [];

    const earnedById = new Map();
    for (const earned of earnedRows) {
        const trophyId = clampInt(earned?.trophyId, 0);
        if (!trophyId) continue;
        earnedById.set(trophyId, {
            earnedAt: parseIsoDateToSeconds(earned?.earnedDateTime),
            trophyType: normalizePsnTrophyType(earned?.trophyType)
        });
    }
    if (!earnedById.size) return [];

    const titleResponse = await getTitleTrophies(
        authorization,
        communicationId,
        "all",
        options
    );
    const titleRows = Array.isArray(titleResponse?.trophies) ? titleResponse.trophies : [];
    const details = titleRows
        .map((item) => {
            const trophyId = clampInt(item?.trophyId, 0);
            if (!trophyId) return null;
            const earnedMeta = earnedById.get(trophyId);
            if (!earnedMeta) return null;
            return {
                trophyId,
                trophyName: sanitizeText(item?.trophyName || `Troféu #${trophyId}`, 160) || `Troféu #${trophyId}`,
                trophyDetail: sanitizeText(item?.trophyDetail || "", 280),
                trophyType: normalizePsnTrophyType(item?.trophyType || earnedMeta.trophyType),
                earnedAt: clampInt(earnedMeta.earnedAt, 0)
            };
        })
        .filter(Boolean)
        .sort(comparePsnEarnedTrophies);

    return details;
}

async function getPsnTitleDetailsView(userId, { npServiceName, npCommunicationId }) {
    const service = sanitizeText(npServiceName, 16);
    const communicationId = sanitizeText(npCommunicationId, 40);
    if (!service || !communicationId) return null;

    const title = await dbGet(
        `SELECT np_service_name, np_communication_id, title_name, title_icon_url, title_platform,
                progress, earned_bronze, earned_silver, earned_gold, earned_platinum
         FROM user_psn_titles
         WHERE user_id = ? AND np_service_name = ? AND np_communication_id = ?
         LIMIT 1`,
        [userId, service, communicationId]
    );
    if (!title) return null;

    const { authorization } = await getPsnAuthorizationForUser(userId);
    const earnedTrophies = await fetchPsnEarnedTrophiesForTitle({
        authorization,
        npServiceName: service,
        npCommunicationId: communicationId
    });
    const totals = {
        bronze: clampInt(title?.earned_bronze, 0),
        silver: clampInt(title?.earned_silver, 0),
        gold: clampInt(title?.earned_gold, 0),
        platinum: clampInt(title?.earned_platinum, 0)
    };
    const normalizedEarned = earnedTrophies.map((item) => ({
        trophyId: clampInt(item?.trophyId, 0),
        trophyName: sanitizeText(item?.trophyName || "", 160),
        trophyDetail: sanitizeText(item?.trophyDetail || "", 280),
        trophyType: normalizePsnTrophyType(item?.trophyType),
        earnedAt: clampInt(item?.earnedAt, 0)
    }));
    const countedByTier = {
        bronze: 0,
        silver: 0,
        gold: 0,
        platinum: 0
    };
    normalizedEarned.forEach((item) => {
        const tier = normalizePsnTrophyType(item?.trophyType);
        if (!tier || !Object.prototype.hasOwnProperty.call(countedByTier, tier)) return;
        countedByTier[tier] += 1;
    });
    const completeEarned = normalizedEarned.slice();
    ["platinum", "gold", "silver", "bronze"].forEach((tier) => {
        const expected = clampInt(totals[tier], 0);
        const existing = clampInt(countedByTier[tier], 0);
        const missing = Math.max(0, expected - existing);
        for (let index = 0; index < missing; index += 1) {
            completeEarned.push({
                trophyId: 0,
                trophyName: `${psnTierLabelFromType(tier)} conquistado`,
                trophyDetail: "Registro local da sincronização PSN.",
                trophyType: tier,
                earnedAt: 0
            });
        }
    });
    completeEarned.sort(comparePsnEarnedTrophies);

    return {
        title: {
            npServiceName: sanitizeText(title?.np_service_name || "", 16),
            npCommunicationId: sanitizeText(title?.np_communication_id || "", 40),
            titleName: sanitizeText(title?.title_name || "", 140),
            titleIconUrl: sanitizeText(title?.title_icon_url || "", 500),
            titlePlatform: sanitizeText(title?.title_platform || "", 40),
            progress: clampInt(title?.progress, 0, 100)
        },
        earnedTrophies: completeEarned,
        totals
    };
}

function comparePsnTierEntries(a, b) {
    const earnedA = clampInt(a?.earnedAt, 0);
    const earnedB = clampInt(b?.earnedAt, 0);
    if (earnedB !== earnedA) return earnedB - earnedA;
    const gameCompare = String(a?.titleName || "").localeCompare(String(b?.titleName || ""), "pt-BR");
    if (gameCompare !== 0) return gameCompare;
    return String(a?.trophyName || "").localeCompare(String(b?.trophyName || ""), "pt-BR");
}

function getPsnTierCountFromTitle(title, tier) {
    const normalizedTier = normalizePsnTrophyType(tier);
    if (normalizedTier === "platinum") return clampInt(title?.earnedPlatinum, 0);
    if (normalizedTier === "gold") return clampInt(title?.earnedGold, 0);
    if (normalizedTier === "silver") return clampInt(title?.earnedSilver, 0);
    return clampInt(title?.earnedBronze, 0);
}

async function fetchAllPsnTitlesFromApi(authorization) {
    const limit = 200;
    const maxPages = 20;
    const byKey = new Map();
    for (let page = 0; page < maxPages; page += 1) {
        const offset = page * limit;
        const response = await getUserTitles(authorization, "me", { limit, offset });
        const normalized = normalizePsnTitleList(response?.trophyTitles || []);
        if (!normalized.length) break;
        normalized.forEach((title) => {
            const key = `${sanitizeText(title?.npServiceName || "", 16)}|${sanitizeText(title?.npCommunicationId || "", 40)}`;
            if (!key || key === "|") return;
            if (!byKey.has(key)) {
                byKey.set(key, title);
            }
        });
        if (normalized.length < limit) break;
    }
    return [...byKey.values()];
}

async function getPsnTierDetailsView(userId, { tier, page = 1, pageSize = 10 }) {
    const normalizedTier = normalizePsnTrophyType(tier);
    const normalizedPage = clampInt(page, 1);
    const normalizedPageSize = clampInt(pageSize, 1, 50) || 10;
    const { authorization } = await getPsnAuthorizationForUser(userId);
    const titleRows = await dbAll(
        `SELECT np_service_name, np_communication_id, title_name, title_icon_url, title_platform,
                earned_bronze, earned_silver, earned_gold, earned_platinum
         FROM user_psn_titles
         WHERE user_id = ?
         ORDER BY COALESCE(last_updated_at, synced_at) DESC, title_name COLLATE NOCASE ASC`,
        [userId]
    );
    let titles = (Array.isArray(titleRows) ? titleRows : []).map((row) => ({
        npServiceName: sanitizeText(row?.np_service_name || "", 16),
        npCommunicationId: sanitizeText(row?.np_communication_id || "", 40),
        titleName: sanitizeText(row?.title_name || "", 140),
        titleIconUrl: sanitizeText(row?.title_icon_url || "", 500),
        titlePlatform: sanitizeText(row?.title_platform || "", 40),
        earnedBronze: clampInt(row?.earned_bronze, 0),
        earnedSilver: clampInt(row?.earned_silver, 0),
        earnedGold: clampInt(row?.earned_gold, 0),
        earnedPlatinum: clampInt(row?.earned_platinum, 0)
    }));
    if (!titles.length) {
        try {
            titles = await fetchAllPsnTitlesFromApi(authorization);
        } catch {
            titles = [];
        }
    }
    if (!titles.length) {
        const summaryRow = await dbGet(
            `SELECT psn_trophies_bronze, psn_trophies_silver, psn_trophies_gold, psn_trophies_platinum
             FROM users
             WHERE id = ? LIMIT 1`,
            [userId]
        );
        let summaryExpectedCount = 0;
        if (normalizedTier === "platinum") summaryExpectedCount = clampInt(summaryRow?.psn_trophies_platinum, 0);
        else if (normalizedTier === "gold") summaryExpectedCount = clampInt(summaryRow?.psn_trophies_gold, 0);
        else if (normalizedTier === "silver") summaryExpectedCount = clampInt(summaryRow?.psn_trophies_silver, 0);
        else summaryExpectedCount = clampInt(summaryRow?.psn_trophies_bronze, 0);
        const totalPages = Math.max(1, Math.ceil(summaryExpectedCount / normalizedPageSize));
        const safePage = Math.min(totalPages, normalizedPage);
        const start = (safePage - 1) * normalizedPageSize;
        const end = Math.min(summaryExpectedCount, start + normalizedPageSize);
        const entries = [];
        const missingCount = Math.max(0, end - start);
        for (let index = 0; index < missingCount; index += 1) {
            entries.push({
                npServiceName: "",
                npCommunicationId: "",
                titleName: "Jogo não identificado",
                titleIconUrl: "",
                titlePlatform: "",
                trophyId: 0,
                trophyName: `${psnTierLabelFromType(normalizedTier)} conquistado`,
                trophyDetail: "Registro local da sincronização PSN.",
                trophyType: normalizedTier,
                earnedAt: 0
            });
        }
        return {
            tier: normalizedTier,
            tierLabel: psnTierLabelFromType(normalizedTier),
            total: summaryExpectedCount,
            page: safePage,
            pageSize: normalizedPageSize,
            totalPages,
            entries
        };
    }

    const queue = titles
        .map((row) => ({
            npServiceName: sanitizeText(row?.npServiceName || "", 16),
            npCommunicationId: sanitizeText(row?.npCommunicationId || "", 40),
            titleName: sanitizeText(row?.titleName || "", 140),
            titleIconUrl: sanitizeText(row?.titleIconUrl || "", 500),
            titlePlatform: sanitizeText(row?.titlePlatform || "", 40),
            earnedCount: getPsnTierCountFromTitle(row, normalizedTier)
        }))
        .filter((title) => title.npServiceName && title.npCommunicationId && title.earnedCount > 0);
    const queueTotal = queue.reduce((sum, item) => sum + clampInt(item?.earnedCount, 0), 0);
    const summaryRow = await dbGet(
        `SELECT psn_trophies_bronze, psn_trophies_silver, psn_trophies_gold, psn_trophies_platinum
         FROM users
         WHERE id = ? LIMIT 1`,
        [userId]
    );
    let summaryExpectedCount = 0;
    if (normalizedTier === "platinum") summaryExpectedCount = clampInt(summaryRow?.psn_trophies_platinum, 0);
    else if (normalizedTier === "gold") summaryExpectedCount = clampInt(summaryRow?.psn_trophies_gold, 0);
    else if (normalizedTier === "silver") summaryExpectedCount = clampInt(summaryRow?.psn_trophies_silver, 0);
    else summaryExpectedCount = clampInt(summaryRow?.psn_trophies_bronze, 0);
    const total = Math.max(queueTotal, summaryExpectedCount);
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const safePage = Math.min(totalPages, normalizedPage);
    const start = (safePage - 1) * normalizedPageSize;
    const end = Math.min(total, start + normalizedPageSize);
    if (!queue.length || start >= end) {
        return {
            tier: normalizedTier,
            tierLabel: psnTierLabelFromType(normalizedTier),
            total,
            page: safePage,
            pageSize: normalizedPageSize,
            totalPages,
            entries: []
        };
    }

    const entries = [];
    let cursor = 0;
    for (const title of queue) {
        const expectedCount = clampInt(title?.earnedCount, 0);
        if (expectedCount <= 0) continue;
        const rangeStart = cursor;
        const rangeEnd = cursor + expectedCount;
        cursor = rangeEnd;
        if (rangeEnd <= start) continue;
        if (rangeStart >= end) break;

        let matchedEntries = [];
        try {
            const earnedTrophies = await fetchPsnEarnedTrophiesForTitle({
                authorization,
                npServiceName: title.npServiceName,
                npCommunicationId: title.npCommunicationId
            });
            matchedEntries = earnedTrophies
                .filter((trophy) => normalizePsnTrophyType(trophy?.trophyType) === normalizedTier)
                .map((trophy) => ({
                    npServiceName: title.npServiceName,
                    npCommunicationId: title.npCommunicationId,
                    titleName: title.titleName || "Jogo PSN",
                    titleIconUrl: title.titleIconUrl,
                    titlePlatform: title.titlePlatform,
                    trophyId: clampInt(trophy?.trophyId, 0),
                    trophyName: sanitizeText(trophy?.trophyName || "", 160) || "Troféu",
                    trophyDetail: sanitizeText(trophy?.trophyDetail || "", 280),
                    trophyType: normalizedTier,
                    earnedAt: clampInt(trophy?.earnedAt, 0)
                }));
        } catch {
            matchedEntries = [];
        }

        const missingCount = Math.max(0, expectedCount - matchedEntries.length);
        const combined = matchedEntries.slice();
        for (let index = 0; index < missingCount; index += 1) {
            combined.push({
                npServiceName: title.npServiceName,
                npCommunicationId: title.npCommunicationId,
                titleName: title.titleName || "Jogo PSN",
                titleIconUrl: title.titleIconUrl,
                titlePlatform: title.titlePlatform,
                trophyId: 0,
                trophyName: `${psnTierLabelFromType(normalizedTier)} conquistado`,
                trophyDetail: "Registro local da sincronização PSN.",
                trophyType: normalizedTier,
                earnedAt: 0
            });
        }

        const localStart = Math.max(0, start - rangeStart);
        const localEnd = Math.min(expectedCount, end - rangeStart);
        entries.push(...combined.slice(localStart, localEnd));
    }

    const requiredCount = Math.max(0, end - start);
    while (entries.length < requiredCount) {
        entries.push({
            npServiceName: "",
            npCommunicationId: "",
            titleName: "Jogo não identificado",
            titleIconUrl: "",
            titlePlatform: "",
            trophyId: 0,
            trophyName: `${psnTierLabelFromType(normalizedTier)} conquistado`,
            trophyDetail: "Registro local da sincronização PSN.",
            trophyType: normalizedTier,
            earnedAt: 0
        });
    }

    return {
        tier: normalizedTier,
        tierLabel: psnTierLabelFromType(normalizedTier),
        total,
        page: safePage,
        pageSize: normalizedPageSize,
        totalPages,
        entries
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
        return res.status(500).json({ message: "Erro ao carregar papéis de usuários." });
    }
});

app.get("/api/users/roles", requireAuth, async (req, res) => {
    try {
        const users = await listUserRolesForClient();
        return res.json({ users });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar papéis de usuários." });
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
            const pendingOwnerActionCount = pendingOwnerActionRequests.length;
            const suggestionsCountRow = await dbGet("SELECT COUNT(*) AS total FROM suggestions");
            const pendingOwnerSuggestionCount = Number(suggestionsCountRow?.total || 0);
            return res.json({
                pendingOwnerActionCount,
                pendingOwnerSuggestionCount,
                ownerNotificationCount: pendingOwnerActionCount + pendingOwnerSuggestionCount,
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

app.get("/api/users/:userId/psn/titles", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const targetExists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!targetExists) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        const { page, pageSize } = parsePaginationParams(req.query, {
            defaultPage: 1,
            defaultPageSize: 10,
            maxPageSize: 20
        });
        const payload = await getPsnTitlesPageView(userId, { page, pageSize });
        return res.json(payload);
    } catch (error) {
        console.error("[psn-titles-page]", error);
        const status = Number(error?.statusCode) || 502;
        return res.status(status).json({ message: psnTitleDetailsMessageFromError(error) });
    }
});

app.get("/api/users/:userId/psn/title-details", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }

        const npServiceName = sanitizeText(req.query?.npServiceName || "", 16);
        const npCommunicationId = sanitizeText(req.query?.npCommunicationId || "", 40);
        if (!npServiceName || !npCommunicationId) {
            return res.status(400).json({ message: "Título PSN inválido." });
        }

        const targetExists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!targetExists) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        const details = await getPsnTitleDetailsView(userId, {
            npServiceName,
            npCommunicationId
        });
        if (!details) {
            return res.status(404).json({ message: "Título de troféus não encontrado para este perfil." });
        }
        return res.json(details);
    } catch (error) {
        console.error("[psn-title-details]", error);
        const status = Number(error?.statusCode) || 502;
        return res.status(status).json({ message: psnTitleDetailsMessageFromError(error) });
    }
});

app.get("/api/users/:userId/psn/trophies-by-tier", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuário inválido." });
        }
        const tier = parsePsnTrophyTier(req.query?.tier || "");
        if (!tier) {
            return res.status(400).json({ message: "Categoria de troféu inválida." });
        }
        const targetExists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!targetExists) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        const { page, pageSize } = parsePaginationParams(req.query, {
            defaultPage: 1,
            defaultPageSize: 10,
            maxPageSize: 20
        });
        const details = await getPsnTierDetailsView(userId, { tier, page, pageSize });
        return res.json(details);
    } catch (error) {
        console.error("[psn-tier-details]", error);
        const status = Number(error?.statusCode) || 502;
        return res.status(status).json({ message: psnTitleDetailsMessageFromError(error) });
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

app.get("/api/user/psn/auto-npsso", requireAuth, async (req, res) => {
    try {
        const result = await tryReadNpssoFromSonyCookieEndpoint();
        return res.json(result);
    } catch (error) {
        console.error("[psn-auto-npsso]", error);
        return res.json({
            ok: false,
            npsso: "",
            reason: "request_failed",
            message: "Falha ao tentar obter o NPSSO automaticamente."
        });
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
                return res.status(400).json({ message: "Comentário pai inválido para este perfil." });
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
                return res.status(400).json({ message: "Comentário pai inválido para este perfil." });
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
            return res.status(400).json({ message: "Comentário inválido." });
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
            return res.status(400).json({ message: "Comentário inválido." });
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
            return res.status(400).json({ message: "Comentário inválido." });
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
            return res.status(400).json({ message: "Comentário inválido." });
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
            return res.status(400).json({ message: "Email inválido." });
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
