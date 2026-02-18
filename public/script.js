const page = document.body.dataset.page;
const baseAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' rx='16' fill='%23101933'/%3E%3Ccircle cx='60' cy='46' r='22' fill='%2339d2ff'/%3E%3Crect x='25' y='77' width='70' height='28' rx='14' fill='%234f79ff'/%3E%3C/svg%3E";
const lockedAchievementImageDataUri =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23101318'/%3E%3Cstop offset='100%25' stop-color='%2305070c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='300' height='400' fill='url(%23g)'/%3E%3Ccircle cx='150' cy='170' r='58' fill='none' stroke='%233b4452' stroke-width='14'/%3E%3Crect x='142' y='140' width='16' height='74' rx='8' fill='%233b4452'/%3E%3Crect x='110' y='226' width='80' height='16' rx='8' fill='%233b4452'/%3E%3Ctext x='150' y='304' text-anchor='middle' fill='%237b879d' font-size='38' font-family='Arial'%3E%3F%3C/text%3E%3C/svg%3E";
let sessionUserId = 0;
let sessionProfileLoaded = false;
let sessionProfile = null;
let sessionIsOwner = false;
let sessionIsModerator = false;
const userRoleMapById = new Map();
const recommendationCommentFormState = new Map();
const recommendationCommentSignatureCaches = {
    home: new Map(),
    round: new Map()
};
const recommendationCommentIdsCaches = {
    home: new Map(),
    round: new Map()
};
const achievementKeysOrdered = [
    "CGFerro",
    "CGBronze",
    "CGPrata",
    "CGOuro",
    "CGDiamante",
    "CGMaster",
    "CGAcao",
    "CGAventura",
    "CGDrama",
    "CGNarrativo",
    "CGRPG",
    "CGPlataforma",
    "CGCorrida",
    "CGMundoAberto",
    "CGTiro",
    "CGTerror",
    "CGSouls",
    "CGAwards",
    "CGOld",
    "CGNewba"
];
let achievementClaimInFlight = false;
let achievementSound = null;
const achievementAccentColorCache = new Map();
const recentAchievementToastKeys = new Map();
let adminNotificationEventSource = null;
let adminNotificationUnloadBound = false;
let adminNotificationSyncBound = false;
let adminLatestResolvedDecisionId = 0;
let roundRealtimeEventSource = null;
let roundRealtimeUnloadBound = false;
let roundRealtimeLastEventSignature = "";
let homePhaseRefreshTimer = 0;
let roundPhaseRefreshTimer = 0;
const appBootOverlayStartedAt = Date.now();
let appBootOverlayDone = false;

function finishAppBootOverlay() {
    if (appBootOverlayDone) return;
    appBootOverlayDone = true;
    if (document.body) {
        document.body.classList.add("app-ready");
    }
}

function scheduleAppBootOverlayFinish() {
    const minVisibleMs = 1000;
    const elapsed = Date.now() - appBootOverlayStartedAt;
    const waitMs = Math.max(0, minVisibleMs - elapsed);
    window.setTimeout(() => {
        window.requestAnimationFrame(() => {
            finishAppBootOverlay();
        });
    }, waitMs);
}

if (document.readyState === "complete") {
    scheduleAppBootOverlayFinish();
} else {
    window.addEventListener("load", scheduleAppBootOverlayFinish, { once: true });
}
window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
        scheduleAppBootOverlayFinish();
    }
});

function byId(id) {
    return document.getElementById(id);
}

function ensureRawgAttributionLink() {
    if (!document.body) return;
    if (byId("rawgAttributionBadge")) return;
    const badge = document.createElement("div");
    badge.id = "rawgAttributionBadge";
    badge.className = "rawg-attribution";
    badge.innerHTML = 'Dados e imagens: <a href="https://rawg.io/apidocs" target="_blank" rel="noopener noreferrer">RAWG</a>';
    document.body.appendChild(badge);
}

function normalizeTextArtifacts(value) {
    let text = String(value ?? "");
    if (!text || !/[\u00C3\u00C2\u00E2]/.test(text)) return text;
    try {
        const repaired = decodeURIComponent(escape(text));
        if (repaired) text = repaired;
    } catch {
        // Mantem texto original quando nao for possivel reparar.
    }
    text = text.replaceAll("\uFFFD", "");
    return text;
}

function looksMostlyEnglishText(value) {
    const text = String(value || "").toLowerCase();
    if (!text.trim()) return false;
    const enHits = (text.match(/\b(the|and|you|your|with|for|from|into|about|game|players|story|world|discover|fight|build|survive)\b/g) || []).length;
    const ptHits = (text.match(/\b(de|do|da|dos|das|um|uma|para|com|sem|sobre|entre|jogo|jogador|historia|voce|nao|que)\b/g) || []).length;
    const accentHits = /[\u00E1\u00E0\u00E2\u00E3\u00E9\u00EA\u00ED\u00F3\u00F4\u00F5\u00FA\u00E7]/i.test(text) ? 1 : 0;
    return enHits >= 3 && enHits > (ptHits + accentHits);
}

function normalizePayloadTextArtifacts(value, visited = new WeakSet()) {
    if (typeof value === "string") {
        return normalizeTextArtifacts(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => normalizePayloadTextArtifacts(item, visited));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    if (visited.has(value)) {
        return value;
    }
    visited.add(value);

    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
        normalized[key] = normalizePayloadTextArtifacts(entry, visited);
    });
    return normalized;
}

function clampColorChannel(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function normalizeAccentChannel(value) {
    // Keep accents vivid enough to be visible over the dark frame.
    return clampColorChannel((Number(value) || 0) * 0.82 + 46);
}

function computeAchievementAccentColor(img) {
    if (!(img instanceof HTMLImageElement)) return "";
    const src = String(img.currentSrc || img.src || "").trim();
    if (!src) return "";
    const cached = achievementAccentColorCache.get(src);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    const size = 28;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";

    try {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const pixels = ctx.getImageData(0, 0, size, size).data;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let totalWeight = 0;

        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const a = pixels[i + 3];
            if (a < 70) continue;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max === 0 ? 0 : (max - min) / max;
            const brightness = (r + g + b) / 3;
            const weight = brightness < 36 && saturation < 0.12 ? 0.2 : 1;

            sumR += r * weight;
            sumG += g * weight;
            sumB += b * weight;
            totalWeight += weight;
        }

        if (totalWeight <= 0) return "";

        const red = normalizeAccentChannel(sumR / totalWeight);
        const green = normalizeAccentChannel(sumG / totalWeight);
        const blue = normalizeAccentChannel(sumB / totalWeight);
        const color = `rgb(${red}, ${green}, ${blue})`;
        achievementAccentColorCache.set(src, color);
        return color;
    } catch {
        return "";
    }
}

function applyAchievementAccentColor(item) {
    if (!(item instanceof HTMLElement)) return;
    const img = item.querySelector("img");
    if (!(img instanceof HTMLImageElement)) return;

    const setColor = () => {
        const color = computeAchievementAccentColor(img);
        if (color) item.style.setProperty("--achievement-accent-color", color);
    };

    if (img.complete && img.naturalWidth > 0) {
        setColor();
        return;
    }

    if (img.dataset.achievementAccentBound !== "1") {
        img.dataset.achievementAccentBound = "1";
        img.addEventListener("load", setColor, { once: true });
    }
}

function normalizeRole(value) {
    return String(value || "").trim().toLowerCase() === "moderator" ? "moderator" : "user";
}

function resolveUserId(userLike) {
    const id = Number(userLike?.user_id || userLike?.id || 0);
    return Number.isInteger(id) && id > 0 ? id : 0;
}

function resolveRoleInfo(userLike) {
    const explicitOwner = Boolean(
        userLike?.isOwner
        || userLike?.is_owner
        || userLike?.role === "owner"
        || userLike?.user_role === "owner"
    );
    const explicitModerator = Boolean(
        userLike?.isModerator
        || userLike?.is_moderator
        || normalizeRole(userLike?.role) === "moderator"
        || normalizeRole(userLike?.user_role) === "moderator"
    );

    let isOwner = explicitOwner;
    let isModerator = !isOwner && explicitModerator;
    if (!isOwner && !isModerator) {
        const userId = resolveUserId(userLike);
        if (userId && userRoleMapById.has(userId)) {
            const fromMap = userRoleMapById.get(userId);
            isOwner = Boolean(fromMap?.is_owner);
            isModerator = !isOwner && Boolean(fromMap?.is_moderator);
        }
    }
    return { isOwner, isModerator };
}

async function ensureUserRolesMap(force = false) {
    if (!force && userRoleMapById.size > 0) return;
    const data = await sendJsonWithFallback([
        { url: "/api/users/roles-map" },
        { url: "/api/users/roles" }
    ]);
    userRoleMapById.clear();
    (data.users || []).forEach((item) => {
        const id = Number(item?.id || 0);
        if (!id) return;
        userRoleMapById.set(id, {
            role: normalizeRole(item?.role),
            is_owner: Boolean(item?.is_owner),
            is_moderator: Boolean(item?.is_moderator)
        });
    });
}

function setupPasswordVisibilityToggles() {
    const syncPasswordToggleState = (button, input) => {
        const isVisible = input.type !== "password";
        button.classList.toggle("is-visible", isVisible);
        button.classList.toggle("is-hidden", !isVisible);
        button.setAttribute("aria-pressed", isVisible ? "true" : "false");
        const nextLabel = isVisible ? "Ocultar senha" : "Mostrar senha";
        button.setAttribute("aria-label", nextLabel);
        button.setAttribute("title", nextLabel);
    };

    document.querySelectorAll("button[data-password-toggle]").forEach((button) => {
        if (button.dataset.passwordToggleBound === "1") return;
        button.dataset.passwordToggleBound = "1";
        const targetId = String(button.dataset.passwordToggle || "");
        const input = byId(targetId);
        if (!(input instanceof HTMLInputElement)) return;
        syncPasswordToggleState(button, input);
        button.addEventListener("click", () => {
            const shouldReveal = input.type === "password";
            input.type = shouldReveal ? "text" : "password";
            syncPasswordToggleState(button, input);
        });
    });
}

function setupPasswordPasteBlock() {
    document.querySelectorAll("input[type='password'], input[name='confirmPassword']").forEach((input) => {
        if (!(input instanceof HTMLInputElement)) return;
        if (input.dataset.passwordPasteBlocked === "1") return;
        input.dataset.passwordPasteBlocked = "1";
        input.addEventListener("paste", (event) => {
            event.preventDefault();
        });
    });
}

function escapeHtml(value) {
    return normalizeTextArtifacts(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function displayName(userLike) {
    if (!userLike) return "Jogador";
    const baseRaw = normalizeTextArtifacts(userLike.nickname || userLike.username || "Jogador");
    const base = String(baseRaw).trim() || "Jogador";
    const roleInfo = resolveRoleInfo(userLike);
    if (roleInfo.isOwner) {
        const ownerBase = base.replace(/\s*\((?:Dono|Moderador|adm)\)\s*$/i, "").trim() || "Jogador";
        return `${ownerBase} (Dono)`;
    }
    if (roleInfo.isModerator) {
        const moderatorBase = base.replace(/\s*\((?:Dono|Moderador|adm)\)\s*$/i, "").trim() || "Jogador";
        return `${moderatorBase} (adm)`;
    }
    return base;
}

function displayNameRoleClass(userLike) {
    const roleInfo = resolveRoleInfo(userLike);
    if (roleInfo.isOwner) return "user-name-owner";
    if (roleInfo.isModerator) return "user-name-moderator";
    return "";
}

function displayNameStyledHtml(userLike) {
    const roleClass = displayNameRoleClass(userLike);
    const classes = roleClass ? `user-name ${roleClass}` : "user-name";
    return `<span class="${classes}">${escapeHtml(displayName(userLike))}</span>`;
}

function formatRoundDate(timestampSeconds) {
    if (!timestampSeconds) return "--/--/----";
    return new Date(Number(timestampSeconds) * 1000).toLocaleDateString("pt-BR");
}

function formatRoundDateTime(timestampSeconds) {
    if (!timestampSeconds) return "--/--/---- - --:--";
    const date = new Date(Number(timestampSeconds) * 1000);
    const day = date.toLocaleDateString("pt-BR");
    const time = date.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
    });
    return `${day} - ${time}`;
}

function homeRoundPhaseLabel(round) {
    const phase = String(round?.phase || round?.status || "").toLowerCase();
    if (phase === "reopened") return "Fase de avalia\u00e7\u00e3o (reaberta)";
    if (phase === "rating") return "Fase de avalia\u00e7\u00e3o";
    if (phase === "indication") return "Fase de indica\u00e7\u00e3o";
    return String(round?.status || phase || "-");
}

function suggestionTargetLabel(target) {
    const normalized = String(target || "").trim().toLowerCase();
    if (normalized === "profile") return "Perfil";
    if (normalized === "round") return "Rodada";
    if (normalized === "admin") return "Administrador";
    return "In\u00edcio";
}

function suggestionTargetsForCurrentUser() {
    const targets = [
        { value: "home", label: suggestionTargetLabel("home") },
        { value: "profile", label: suggestionTargetLabel("profile") },
        { value: "round", label: suggestionTargetLabel("round") }
    ];
    if (sessionIsOwner || sessionIsModerator) {
        targets.push({ value: "admin", label: suggestionTargetLabel("admin") });
    }
    return targets;
}

function profileUrlByUserId(userId) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) return "/profile.html";
    return `/profile.html?userId=${numericUserId}`;
}

function userLinkHtml(userLike, userId) {
    const numericUserId = Number(userId);
    const enrichedUser = {
        ...(userLike || {}),
        id: resolveUserId(userLike) || (Number.isInteger(numericUserId) ? numericUserId : 0)
    };
    const labelHtml = displayNameStyledHtml(enrichedUser);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        return labelHtml;
    }
    return `<a class="user-link" href="${escapeHtml(profileUrlByUserId(numericUserId))}">${labelHtml}</a>`;
}

function commentAuthorHtml(userLike) {
    const avatar = escapeHtml(userLike?.avatar_url || baseAvatar);
    const linkUserId = Number(userLike?.user_id || userLike?.id || 0);
    return `
        <span class="comment-author">
            <img class="comment-avatar" src="${avatar}" alt="avatar">
            ${userLinkHtml(userLike, linkUserId)}
        </span>
    `;
}

function commentLikesMeta(comment) {
    const likesCount = Math.max(0, Number(comment?.likes_count ?? comment?.likesCount ?? 0));
    const likedByMe = Boolean(Number(comment?.liked_by_me ?? comment?.likedByMe ?? 0));
    return { likesCount, likedByMe };
}

function commentLikeActionsHtml(comment, options = {}) {
    const commentId = Number(comment?.id || 0);
    if (!commentId) return "";
    const likeScope = String(options.likeScope || "").trim().toLowerCase();
    const recommendationId = Number(options.recommendationId || comment?.recommendation_id || 0);
    const { likesCount, likedByMe } = commentLikesMeta(comment);
    const recommendationAttrs = recommendationId > 0
        ? ` data-recommendation-id="${recommendationId}"`
        : "";
    return `
        <button
            class="comment-action comment-like-btn${likedByMe ? " is-liked" : ""}"
            type="button"
            data-comment-like-toggle="${likeScope}"
            data-comment-id="${commentId}"${recommendationAttrs}
            aria-pressed="${likedByMe ? "true" : "false"}"
            title="${likedByMe ? "Descurtir" : "Curtir"}"
        ><span class="comment-like-icon" aria-hidden="true">${likedByMe ? "\u2665" : "\u2661"}</span></button>
        ${likesCount > 0
            ? `<button class="comment-action comment-like-count" type="button" data-comment-like-list="${likeScope}" data-comment-id="${commentId}"${recommendationAttrs}>${likesCount}</button>`
            : ""}
    `;
}

function commentItemHtml(comment, options = {}) {
    const recommendationId = Number(options.recommendationId || comment.recommendation_id || 0);
    const interactive = options.interactive === true && recommendationId > 0;
    const ownComment = sessionUserId > 0 && Number(comment.user_id) === sessionUserId;
    const canDeleteComment = ownComment || sessionIsOwner;
    const depth = Math.max(0, Math.min(4, Number(options.depth || 0)));
    const parentAuthor = String(options.parentAuthor || "").trim();
    const actions = interactive
        ? `
            <div class="comment-actions">
                ${commentLikeActionsHtml(comment, { likeScope: "recommendation", recommendationId })}
                <button class="comment-action" type="button" data-comment-action="reply" data-comment-id="${Number(comment.id) || 0}" data-recommendation-id="${recommendationId}">Responder</button>
                ${ownComment ? `<button class="comment-action" type="button" data-comment-action="edit" data-comment-id="${Number(comment.id) || 0}" data-recommendation-id="${recommendationId}">Editar</button>` : ""}
                ${canDeleteComment ? `<button class="comment-action danger" type="button" data-comment-action="delete" data-comment-id="${Number(comment.id) || 0}" data-recommendation-id="${recommendationId}">Excluir</button>` : ""}
            </div>
          `
        : "";
    const replyTarget = parentAuthor ? `<span class="comment-reply-to">@${escapeHtml(parentAuthor)}</span>` : "";
    return `
        <div class="comment-item${depth ? " comment-reply" : ""}" style="--comment-depth:${depth}" data-comment-id="${Number(comment.id) || 0}">
            <span class="comment-head">${commentAuthorHtml(comment)}</span>
            <span class="comment-body-line">
                ${replyTarget}
                <span class="comment-text">${escapeHtml(comment.comment_text)}</span>
            </span>
            ${actions}
        </div>
    `;
}

function commentSortValue(comment) {
    return Number(comment.created_at || 0) * 100000 + Number(comment.id || 0);
}

function buildCommentDisplayRows(comments) {
    const normalized = Array.isArray(comments) ? comments : [];
    if (!normalized.length) return [];

    const map = new Map();
    normalized.forEach((item) => {
        const id = Number(item.id || 0);
        if (!id) return;
        map.set(id, { ...item, _children: [] });
    });

    const roots = [];
    map.forEach((item) => {
        const parentId = Number(item.parent_comment_id || 0);
        if (parentId > 0 && map.has(parentId) && parentId !== Number(item.id)) {
            map.get(parentId)._children.push(item);
        } else {
            roots.push(item);
        }
    });

    const sorter = (a, b) => commentSortValue(a) - commentSortValue(b);
    const output = [];
    const walk = (node, depth, parent) => {
        output.push({
            comment: node,
            depth,
            parentAuthor: parent ? displayName(parent) : ""
        });
        node._children.sort(sorter).forEach((child) => walk(child, depth + 1, node));
    };

    roots.sort(sorter).forEach((root) => walk(root, 0, null));
    return output;
}

function recommendationCommentsSignature(comments) {
    return (comments || [])
        .map((comment) => `${Number(comment.id) || 0}:${Number(comment.updated_at || 0)}:${Number(comment.parent_comment_id || 0)}:${Number(comment.likes_count || 0)}:${Number(comment.liked_by_me || 0)}`)
        .join("|");
}

function recommendationCommentIds(comments) {
    return (comments || [])
        .map((comment) => Number(comment.id) || 0)
        .filter((id) => id > 0);
}

function recommendationCommentsHtml(recommendationId, comments, options = {}) {
    const rows = buildCommentDisplayRows(comments);
    if (!rows.length) {
        return '<div class="comment-item">Sem comentários ainda.</div>';
    }
    return rows
        .map((row) =>
            commentItemHtml(row.comment, {
                recommendationId,
                interactive: options.interactive === true,
                depth: row.depth,
                parentAuthor: row.parentAuthor
            })
        )
        .join("");
}

function findHomeRecommendationById(recommendationId) {
    const numericId = Number(recommendationId);
    if (!numericId) return null;
    for (const round of homeRoundsMap.values()) {
        const rec = (round.recommendations || []).find((item) => Number(item.id) === numericId);
        if (rec) return rec;
    }
    return null;
}

function findRoundRecommendationById(recommendationId) {
    const numericId = Number(recommendationId);
    if (!numericId || !currentRound) return null;
    return (currentRound.recommendations || []).find((item) => Number(item.id) === numericId) || null;
}

function getRecommendationByScope(scope, recommendationId) {
    return scope === "home"
        ? findHomeRecommendationById(recommendationId)
        : findRoundRecommendationById(recommendationId);
}

function syncRecommendationCommentList(recommendation, scope, force = false) {
    if (!recommendation) return;
    const cache = scope === "home" ? recommendationCommentSignatureCaches.home : recommendationCommentSignatureCaches.round;
    const idsCache = scope === "home" ? recommendationCommentIdsCaches.home : recommendationCommentIdsCaches.round;
    const recommendationId = Number(recommendation.id);
    if (!recommendationId) return;

    const list = byId(`comment-list-${recommendationId}`);
    if (!list) return;
    const comments = recommendation.comments || [];
    const currentIds = recommendationCommentIds(comments);
    const previousIds = idsCache.get(recommendationId);
    const signature = recommendationCommentsSignature(comments);
    if (!force && cache.get(recommendationId) === signature) return;

    cache.set(recommendationId, signature);
    idsCache.set(recommendationId, currentIds);
    list.innerHTML = recommendationCommentsHtml(recommendationId, comments, { interactive: true });

    if (Array.isArray(previousIds)) {
        const previousSet = new Set(previousIds);
        const newCommentIds = currentIds.filter((id) => !previousSet.has(id));
        if (newCommentIds.length) {
            const newIdsSet = new Set(newCommentIds);
            const renderedRows = [...list.querySelectorAll(".comment-item[data-comment-id]")];
            let targetRow = null;
            renderedRows.forEach((row) => {
                const rowId = Number(row.getAttribute("data-comment-id") || 0);
                if (newIdsSet.has(rowId)) targetRow = row;
            });

            requestAnimationFrame(() => {
                if (targetRow instanceof HTMLElement) {
                    targetRow.scrollIntoView({
                        behavior: "auto",
                        block: "nearest",
                        inline: "nearest"
                    });
                } else {
                    list.scrollTop = list.scrollHeight;
                }
            });
        }
    }
}

function clearStaleCommentSignatures(scope, recommendationIds) {
    const cache = scope === "home" ? recommendationCommentSignatureCaches.home : recommendationCommentSignatureCaches.round;
    const idsCache = scope === "home" ? recommendationCommentIdsCaches.home : recommendationCommentIdsCaches.round;
    const keep = new Set((recommendationIds || []).map((id) => Number(id)));
    [...cache.keys()].forEach((key) => {
        if (!keep.has(Number(key))) cache.delete(key);
    });
    [...idsCache.keys()].forEach((key) => {
        if (!keep.has(Number(key))) idsCache.delete(key);
    });
}

function getCommentFormState(recommendationId) {
    const existing = recommendationCommentFormState.get(Number(recommendationId));
    if (existing) return existing;
    return { mode: "new", commentId: 0, parentCommentId: 0, label: "" };
}

function setCommentFormState(recommendationId, state) {
    recommendationCommentFormState.set(Number(recommendationId), {
        mode: state?.mode || "new",
        commentId: Number(state?.commentId || 0),
        parentCommentId: Number(state?.parentCommentId || 0),
        label: String(state?.label || "")
    });
    updateCommentFormUi(recommendationId);
}

function resetCommentFormState(recommendationId) {
    recommendationCommentFormState.set(Number(recommendationId), {
        mode: "new",
        commentId: 0,
        parentCommentId: 0,
        label: ""
    });
    updateCommentFormUi(recommendationId);
}

function updateCommentFormUi(recommendationId) {
    const id = Number(recommendationId);
    if (!id) return;
    const form = document.querySelector(`form[data-comment-form="${id}"]`);
    if (!(form instanceof HTMLFormElement)) return;

    const state = getCommentFormState(id);
    const input = form.querySelector("input[name='commentText']");
    const parentInput = form.querySelector("input[name='parentCommentId']");
    const submit = form.querySelector("button[type='submit']");
    const context = byId(`comment-context-${id}`);

    if (parentInput instanceof HTMLInputElement) {
        parentInput.value = state.mode === "reply" ? String(state.parentCommentId || 0) : "";
    }

    if (state.mode === "edit") {
        form.dataset.editCommentId = String(state.commentId || 0);
        if (submit) submit.textContent = "Salvar";
        if (input instanceof HTMLInputElement) input.placeholder = "Edite seu comentário";
        if (context) {
            context.classList.remove("hidden");
            context.innerHTML = `
                <span>Editando comentário</span>
                <button class="comment-action" type="button" data-comment-context-cancel="${id}">Cancelar</button>
            `;
        }
        if (page === "home") scheduleHomeCommentFormAlignment();
        return;
    }

    delete form.dataset.editCommentId;
    if (submit) submit.textContent = state.mode === "reply" ? "Responder" : "Comentar";
    if (input instanceof HTMLInputElement) {
        input.placeholder = state.mode === "reply" ? "Escreva sua resposta" : "Comentar esta avaliação";
    }
    if (context) {
        if (state.mode === "reply" && state.parentCommentId > 0) {
            context.classList.remove("hidden");
            context.innerHTML = `
                <span>Respondendo ${escapeHtml(state.label || "comentário")}</span>
                <button class="comment-action" type="button" data-comment-context-cancel="${id}">Cancelar</button>
            `;
        } else {
            context.classList.add("hidden");
            context.innerHTML = "";
        }
    }
    if (page === "home") scheduleHomeCommentFormAlignment();
}

function findCommentById(recommendation, commentId) {
    const numericId = Number(commentId);
    if (!recommendation || !numericId) return null;
    return (recommendation.comments || []).find((item) => Number(item.id) === numericId) || null;
}

function upsertRecommendationComment(scope, recommendationId, comment) {
    const recommendation = getRecommendationByScope(scope, recommendationId);
    if (!recommendation) return null;
    if (!Array.isArray(recommendation.comments)) recommendation.comments = [];
    const existingIndex = recommendation.comments.findIndex((item) => Number(item.id) === Number(comment.id));
    if (existingIndex >= 0) recommendation.comments[existingIndex] = comment;
    else recommendation.comments.push(comment);
    recommendation.comments.sort((a, b) => commentSortValue(a) - commentSortValue(b));
    return recommendation;
}

function removeRecommendationComment(scope, recommendationId, commentId) {
    const recommendation = getRecommendationByScope(scope, recommendationId);
    if (!recommendation || !Array.isArray(recommendation.comments)) return null;
    recommendation.comments = recommendation.comments.filter((item) => Number(item.id) !== Number(commentId));
    return recommendation;
}

async function ensureSessionProfile() {
    if (sessionProfileLoaded) return sessionProfile;
    try {
        const data = await sendJson("/api/user/profile");
        const parsed = Number(data?.profile?.id || 0);
        sessionUserId = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
        sessionIsOwner = Boolean(data?.isOwner);
        sessionIsModerator = Boolean(data?.isModerator);
        sessionProfile = data;
    } catch {
        sessionProfile = null;
        sessionUserId = 0;
        sessionIsOwner = false;
        sessionIsModerator = false;
    }
    sessionProfileLoaded = true;
    return sessionProfile;
}

async function ensureSessionUserId() {
    if (!sessionProfileLoaded) {
        await ensureSessionProfile();
    }
    return sessionUserId;
}

function syncOwnerNavLinkVisibility() {
    const adminNavLink = byId("adminNavLink");
    if (!adminNavLink) return;
    if (sessionIsOwner || sessionIsModerator) adminNavLink.classList.remove("hidden");
    else adminNavLink.classList.add("hidden");
}

function adminDecisionSeenStorageKey() {
    return `admin-last-decision-${Number(sessionUserId || 0)}`;
}

function readAdminDecisionSeenId() {
    const key = adminDecisionSeenStorageKey();
    const parsed = Number(window.localStorage.getItem(key) || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function writeAdminDecisionSeenId(decisionId) {
    const parsed = Number(decisionId || 0);
    if (!Number.isInteger(parsed) || parsed <= 0) return;
    window.localStorage.setItem(adminDecisionSeenStorageKey(), String(parsed));
}

function setAdminNotificationDotVisible(visible) {
    const adminNavLink = byId("adminNavLink");
    if (!adminNavLink) return;
    adminNavLink.classList.toggle("has-notification-dot", Boolean(visible));
}

function syncAdminNotificationDotByResolvedId(resolvedDecisionId) {
    const resolvedId = Number(resolvedDecisionId || 0);
    adminLatestResolvedDecisionId = resolvedId > 0 ? resolvedId : 0;
    const seenId = readAdminDecisionSeenId();
    setAdminNotificationDotVisible(adminLatestResolvedDecisionId > seenId);
}

async function syncAdminNotificationState() {
    if (!sessionIsModerator && !sessionIsOwner) {
        setAdminNotificationDotVisible(false);
        return;
    }
    try {
        const data = await sendJsonWithFallback([
            { url: "/api/admin/notification-state" },
            { url: "/api/admin/dashboard" }
        ]);
        if (sessionIsOwner) {
            const pendingCount = Number(
                data?.pendingOwnerActionCount
                || (Array.isArray(data?.pendingOwnerActionRequests) ? data.pendingOwnerActionRequests.length : 0)
                || 0
            );
            setAdminNotificationDotVisible(pendingCount > 0);
            return;
        }
        const latestResolvedId = Number(data?.latestResolvedAdminAction?.id || 0);
        syncAdminNotificationDotByResolvedId(latestResolvedId);
    } catch {
        // polling silencioso
    }
}

function stopAdminNotificationStream() {
    if (adminNotificationEventSource) {
        try {
            adminNotificationEventSource.close();
        } catch {
            // sem acao
        }
        adminNotificationEventSource = null;
    }
}

function startAdminNotificationStream() {
    stopAdminNotificationStream();
    if (!sessionIsModerator && !sessionIsOwner) {
        setAdminNotificationDotVisible(false);
        return;
    }
    syncAdminNotificationState();
    try {
        const stream = new EventSource("/api/admin/events");
        stream.onopen = () => {
            syncAdminNotificationState();
        };
        stream.addEventListener("admin-change", () => {
            syncAdminNotificationState();
            window.dispatchEvent(new CustomEvent("clubedojogo:admin-change"));
        });
        stream.onerror = () => {
            // reconexao automatica do EventSource
        };
        adminNotificationEventSource = stream;
        if (!adminNotificationUnloadBound) {
            adminNotificationUnloadBound = true;
            window.addEventListener("beforeunload", () => {
                stopAdminNotificationStream();
            }, { once: true });
        }
        if (!adminNotificationSyncBound) {
            adminNotificationSyncBound = true;
            const syncOnVisibility = () => {
                if (document.visibilityState === "visible") {
                    syncAdminNotificationState();
                }
            };
            const syncOnFocus = () => {
                syncAdminNotificationState();
            };
            window.addEventListener("focus", syncOnFocus);
            document.addEventListener("visibilitychange", syncOnVisibility);
            window.addEventListener("pageshow", syncOnFocus);
            window.addEventListener("beforeunload", () => {
                window.removeEventListener("focus", syncOnFocus);
                document.removeEventListener("visibilitychange", syncOnVisibility);
                window.removeEventListener("pageshow", syncOnFocus);
            }, { once: true });
        }
    } catch {
        // EventSource indisponivel no navegador.
    }
}

function stopRoundRealtimeStream() {
    if (roundRealtimeEventSource) {
        try {
            roundRealtimeEventSource.close();
        } catch {
            // sem acao
        }
        roundRealtimeEventSource = null;
    }
}

async function handleRoundRealtimeChange(rawPayload) {
    let payload = rawPayload;
    if (typeof payload === "string") {
        try {
            payload = JSON.parse(payload);
        } catch {
            return;
        }
    }
    const reason = String(payload?.reason || "").trim().toLowerCase();
    if (!reason || reason === "connected") return;

    const roundId = Number(payload?.roundId || 0);
    const at = Number(payload?.at || 0);
    const actorUserId = Number(payload?.actorUserId || 0);
    const eventUserId = Number(payload?.userId || 0);
    const signature = `${reason}:${roundId}:${at}:${actorUserId}:${eventUserId}`;
    if (!signature || signature === roundRealtimeLastEventSignature) return;
    roundRealtimeLastEventSignature = signature;

    if (reason === "achievement_unlocked") {
        if (!eventUserId || eventUserId === Number(sessionUserId || 0)) {
            await claimAchievementUnlocksAndNotify();
        }
        return;
    }

    if (page === "home") {
        await Promise.all([refreshHomeActive(), refreshHomeFeed()]);
        return;
    }

    if (page === "round") {
        const currentRoundId = Number(currentRound?.id || getQueryParam("roundId") || 0);
        if (roundId > 0 && currentRoundId > 0 && roundId !== currentRoundId) {
            return;
        }
        await refreshRoundData(roundId || currentRoundId, {
            skipUserSearchReload: Boolean(currentRound && canManageDraftRound(currentRound))
        });
    }
}

function startRoundRealtimeStream() {
    stopRoundRealtimeStream();
    const isAuthenticatedUiPage =
        page === "profile"
        || page === "home"
        || page === "round"
        || page === "admin";
    if (!isAuthenticatedUiPage) return;
    try {
        const stream = new EventSource("/api/rounds/events");
        stream.addEventListener("round-change", (event) => {
            handleRoundRealtimeChange(event.data).catch(() => {
                // ignora erros pontuais de sincronizacao
            });
        });
        stream.onerror = () => {
            // reconexao automatica do EventSource
        };
        roundRealtimeEventSource = stream;
        if (!roundRealtimeUnloadBound) {
            roundRealtimeUnloadBound = true;
            window.addEventListener("beforeunload", () => {
                stopRoundRealtimeStream();
            }, { once: true });
        }
    } catch {
        // EventSource indisponivel no navegador.
    }
}

async function setupOwnerNavLink() {
    await ensureSessionProfile();
    syncOwnerNavLinkVisibility();
    startAdminNotificationStream();
}

function achievementSelectOptionsHtml() {
    return achievementKeysOrdered
        .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`)
        .join("");
}

function parseAchievementKeys(rawKeys) {
    const value = String(rawKeys || "").trim();
    if (!value) return [];
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function formatAchievementKeys(keys) {
    if (!Array.isArray(keys) || !keys.length) return "Sem conquistas";
    return keys.join(", ");
}

function maskEmailForAdminDisplay(emailText) {
    const email = String(emailText || "").trim();
    if (!email || !email.includes("@")) return email;
    const [localPart, domainPart] = email.split("@");
    if (!localPart || !domainPart) return email;
    if (localPart.length <= 2) {
        return `${localPart[0] || ""}****@${domainPart}`;
    }
    const prefix = localPart.slice(0, 2);
    const suffix = localPart.length > 4 ? localPart.slice(-2) : localPart.slice(-1);
    return `${prefix}****${suffix}@${domainPart}`;
}

function renderAdminDashboardUsers(users, userAchievementsMap) {
    return (users || [])
        .map((user) => {
            const userId = Number(user?.id || 0);
            const userLabel = displayName(user);
            const achievementState = userAchievementsMap.get(Number(user.id)) || {
                unlocked_count: 0,
                keys: []
            };
            const actorIsModeratorOnly = sessionIsModerator && !sessionIsOwner;
            const ownAccount = Boolean(user?.is_self) || (userId > 0 && userId === Number(sessionUserId || 0));
            const isOwnerAccount = Boolean(user?.is_owner);
            const isModeratorAccount = !isOwnerAccount && normalizeRole(user?.role) === "moderator";
            const moderatorTargetLocked = actorIsModeratorOnly && isModeratorAccount && !ownAccount;
            const ownerSelfAccount = isOwnerAccount && sessionIsOwner && ownAccount;
            const ownerLockedVisual = isOwnerAccount && !sessionIsOwner;
            const isReadOnlyAccount = isOwnerAccount || moderatorTargetLocked;
            const allowAchievementTools = !moderatorTargetLocked && (!isOwnerAccount || ownerSelfAccount);
            const shownEmail = actorIsModeratorOnly ? maskEmailForAdminDisplay(user.email) : String(user.email || "");
            const roleLabel = isOwnerAccount ? "Dono" : (isModeratorAccount ? "Moderador" : "Usuário");
            const roleToggleButton = sessionIsOwner && !isOwnerAccount
                ? `<button class="btn ${isModeratorAccount ? "btn-success" : "btn-outline"}" data-admin-set-role="${user.id}" data-admin-target-role="${isModeratorAccount ? "user" : "moderator"}" type="button">${isModeratorAccount ? "Remover Moderador" : "Tornar Moderador"}</button>`
                : "";
            const adminActions = isReadOnlyAccount
                ? ""
                : `
                        <button class="btn ${user.blocked ? "btn-outline" : "btn-warn"}" data-admin-toggle-block="${user.id}" data-admin-blocked="${user.blocked ? 1 : 0}" type="button">
                            ${user.blocked ? "Desbloquear" : "Bloquear"}
                        </button>
                        <button class="btn btn-danger" data-admin-delete-user="${user.id}" data-admin-delete-user-name="${escapeHtml(userLabel)}" type="button">Excluir conta</button>
                        ${roleToggleButton}
                  `;
            return `
                <div class="search-item admin-user-item${ownerLockedVisual ? " is-owner-locked" : ""}">
                    <div>
                        <strong>${displayNameStyledHtml(user)}</strong>
                        <div>${escapeHtml(shownEmail)}</div>
                        <div>Cargo: ${roleLabel}</div>
                        <div>Status: ${user.blocked ? "Bloqueado" : "Ativo"}</div>
                        ${isOwnerAccount ? "<div>Conta protegida para bloqueio, exclusão e alteração de cargo.</div>" : ""}
                        ${moderatorTargetLocked ? "<div>Moderador não pode modificar outro moderador.</div>" : ""}
                        <div>Conquistas: ${escapeHtml(formatAchievementKeys(achievementState.keys))}</div>
                    </div>
                    ${adminActions ? `<div class="inline-actions">${adminActions}</div>` : ""}
                    ${allowAchievementTools ? `
                        <div class="admin-achievement-tools">
                            <select data-admin-achievement-key="${user.id}">
                                ${achievementSelectOptionsHtml()}
                            </select>
                            <button class="btn btn-outline" data-admin-grant-achievement="${user.id}" type="button">Dar conquista</button>
                            <button class="btn btn-outline" data-admin-revoke-achievement="${user.id}" type="button">Tirar conquista</button>
                            <span class="admin-achievement-options-link" data-admin-toggle-achievement-options="${user.id}" data-admin-achievement-options-expanded="0" role="button" tabindex="0">Mais opções</span>
                            <div class="admin-achievement-more-options hidden" data-admin-achievement-more-options="${user.id}">
                                <button class="btn btn-danger" data-admin-reset-achievements="${user.id}" type="button">Zerar conquistas</button>
                            </div>
                        </div>
                    ` : ""}
                    <p id="adminUserFeedback-${user.id}" class="feedback hidden admin-user-feedback"></p>
                </div>
            `;
        })
        .join("");
}

function renderAdminDashboardRounds(rounds) {
    return (rounds || [])
        .map(
            (round) => `
                <div class="search-item">
                    <div>
                        <strong>Rodada - ${formatRoundDateTime(round.created_at)}</strong>
                        <div>Status: ${escapeHtml(round.status)}</div>
                        <div>Criador: ${displayNameStyledHtml({ id: round.creator_user_id, nickname: round.creator_nickname, username: round.creator_username })}</div>
                    </div>
                    <div class="inline-actions">
                        <button class="btn btn-outline" data-admin-close-round="${round.id}" type="button">Fechar</button>
                        <button
                            class="btn btn-danger"
                            data-admin-delete-round="${round.id}"
                            data-admin-delete-round-label="Rodada - ${escapeHtml(formatRoundDateTime(round.created_at))}"
                            type="button"
                        >Excluir</button>
                    </div>
                </div>
            `
        )
        .join("");
}

function renderAdminOwnerActionRequests(requests) {
    const normalized = Array.isArray(requests) ? requests : [];
    if (!normalized.length) {
        return `<p class="feedback ok">Sem solicitações pendentes no momento.</p>`;
    }
    return normalized
        .map((request) => {
            const details = Array.isArray(request.detail_lines) ? request.detail_lines : [];
            return `
                <div class="search-item admin-owner-request-item" data-admin-owner-request-id="${Number(request.id) || 0}">
                    <div>
                        <strong>Solicitação #${Number(request.id) || 0}</strong>
                        <div>Solicitante: ${escapeHtml(String(request.requester_name || "-"))}</div>
                        <div>Ação: ${escapeHtml(String(request.action_label || "-"))}</div>
                        ${Number(request.created_at) > 0 ? `<div>Criada em: ${escapeHtml(formatRoundDateTime(request.created_at))}</div>` : ""}
                        ${Number(request.expires_at) > 0 ? `<div>Expira em: ${escapeHtml(formatRoundDateTime(request.expires_at))}</div>` : ""}
                        ${details.length ? `<div class="admin-owner-request-details">${details.map((line) => `<div>${escapeHtml(String(line || ""))}</div>`).join("")}</div>` : ""}
                    </div>
                    <div class="inline-actions">
                        <button class="btn btn-success" type="button" data-admin-owner-request-decision="allow" data-admin-owner-request-id="${Number(request.id) || 0}">Permitir</button>
                        <button class="btn btn-danger" type="button" data-admin-owner-request-decision="deny" data-admin-owner-request-id="${Number(request.id) || 0}">Negar</button>
                    </div>
                </div>
            `;
        })
        .join("");
}

let commentLikesPopupEl = null;
let commentLikesPopupBound = false;

function ensureCommentLikesPopup() {
    if (commentLikesPopupEl instanceof HTMLElement) return commentLikesPopupEl;
    const popup = document.createElement("section");
    popup.id = "commentLikesPopup";
    popup.className = "comment-likes-popup hidden";
    popup.innerHTML = `
        <header class="comment-likes-popup-head">
            <strong>Curtidas</strong>
            <button class="comment-action" type="button" data-comment-likes-close="1">Fechar</button>
        </header>
        <div class="comment-likes-popup-body" data-comment-likes-body="1">
            <div class="comment-likes-empty">Carregando...</div>
        </div>
    `;
    document.body.appendChild(popup);
    commentLikesPopupEl = popup;

    if (!commentLikesPopupBound) {
        commentLikesPopupBound = true;
        document.addEventListener("click", (event) => {
            if (!(commentLikesPopupEl instanceof HTMLElement)) return;
            if (commentLikesPopupEl.classList.contains("hidden")) return;
            const closeBtn = event.target.closest("[data-comment-likes-close]");
            if (closeBtn) {
                closeCommentLikesPopup();
                return;
            }
            if (!event.target.closest("#commentLikesPopup") && !event.target.closest("[data-comment-like-list]")) {
                closeCommentLikesPopup();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeCommentLikesPopup();
        });
        window.addEventListener("resize", closeCommentLikesPopup);
        window.addEventListener("scroll", closeCommentLikesPopup, { capture: true });
    }

    return popup;
}

function closeCommentLikesPopup() {
    if (!(commentLikesPopupEl instanceof HTMLElement)) return;
    commentLikesPopupEl.classList.add("hidden");
}

function positionCommentLikesPopup(anchorElement) {
    if (!(commentLikesPopupEl instanceof HTMLElement) || !(anchorElement instanceof HTMLElement)) return;
    const rect = anchorElement.getBoundingClientRect();
    const popupRect = commentLikesPopupEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 8;
    let left = rect.left + rect.width / 2 - popupRect.width / 2;
    left = Math.max(margin, Math.min(left, Math.max(margin, vw - popupRect.width - margin)));
    let top = rect.bottom + margin;
    if (top + popupRect.height > vh - margin) {
        top = Math.max(margin, rect.top - popupRect.height - margin);
    }
    commentLikesPopupEl.style.left = `${Math.round(left)}px`;
    commentLikesPopupEl.style.top = `${Math.round(top)}px`;
}

function renderCommentLikesPopupList(likes) {
    const popup = ensureCommentLikesPopup();
    const body = popup.querySelector("[data-comment-likes-body='1']");
    if (!(body instanceof HTMLElement)) return;
    const rows = Array.isArray(likes) ? likes : [];
    if (!rows.length) {
        body.innerHTML = '<div class="comment-likes-empty">Sem curtidas ainda.</div>';
        return;
    }
    body.innerHTML = rows
        .map((item) => `
            <div class="comment-likes-item">
                ${commentAuthorHtml({
                    user_id: Number(item.user_id || 0),
                    id: Number(item.user_id || 0),
                    username: item.username,
                    nickname: item.nickname,
                    avatar_url: item.avatar_url
                })}
            </div>
        `)
        .join("");
}

async function showCommentLikesPopup(likeScope, commentId, anchorElement) {
    const numericCommentId = Number(commentId || 0);
    if (!numericCommentId) return;
    const scope = String(likeScope || "").trim().toLowerCase();
    const endpoint = scope === "profile"
        ? `/api/profile-comments/${numericCommentId}/likes`
        : `/api/recommendation-comments/${numericCommentId}/likes`;
    const popup = ensureCommentLikesPopup();
    const body = popup.querySelector("[data-comment-likes-body='1']");
    if (body instanceof HTMLElement) {
        body.innerHTML = '<div class="comment-likes-empty">Carregando...</div>';
    }
    popup.classList.remove("hidden");
    popup.style.left = "8px";
    popup.style.top = "8px";
    positionCommentLikesPopup(anchorElement);
    try {
        const result = await sendJson(endpoint);
        renderCommentLikesPopupList(result?.likes || []);
    } catch (error) {
        if (body instanceof HTMLElement) {
            body.innerHTML = `<div class="comment-likes-empty">${escapeHtml(error.message || "Erro ao carregar curtidas.")}</div>`;
        }
    } finally {
        positionCommentLikesPopup(anchorElement);
    }
}

function renderAdminSuggestions(suggestions) {
    const normalized = Array.isArray(suggestions) ? suggestions : [];
    if (!normalized.length) {
        return `<p class="feedback ok">Sem sugestões no momento.</p>`;
    }
    return normalized
        .map((suggestion) => {
            const id = Number(suggestion?.id || 0);
            const author = displayNameStyledHtml({
                id: Number(suggestion?.user_id || 0),
                nickname: suggestion?.author_nickname,
                username: suggestion?.author_username
            });
            const targetLabel = suggestionTargetLabel(suggestion?.target_page);
            const createdAt = Number(suggestion?.created_at || 0);
            const text = String(suggestion?.suggestion_text || "").trim();
            return `
                <div class="search-item admin-suggestion-item" data-admin-suggestion-id="${id}">
                    <div>
                        <strong>Sugestão #${id}</strong>
                        <div>Usuário: ${author}</div>
                        <div>Tela: ${escapeHtml(targetLabel)}</div>
                        ${createdAt > 0 ? `<div>Criada em: ${escapeHtml(formatRoundDateTime(createdAt))}</div>` : ""}
                        <div class="admin-suggestion-text">${escapeHtml(text)}</div>
                    </div>
                    <div class="inline-actions admin-suggestion-actions">
                        <button class="btn btn-danger" type="button" data-admin-delete-suggestion="${id}">Excluir sugestão</button>
                    </div>
                </div>
            `;
        })
        .join("");
}

async function handleAdminPage() {
    const adminPanel = byId("adminPanel");
    const adminUsersList = byId("adminUsersList");
    const adminRoundsList = byId("adminRoundsList");
    const adminOwnerRequestsCard = byId("adminOwnerRequestsCard");
    const adminOwnerRequestsList = byId("adminOwnerRequestsList");
    const adminSuggestionsCard = byId("adminSuggestionsCard");
    const adminSuggestionsList = byId("adminSuggestionsList");
    if (!adminPanel || !adminUsersList || !adminRoundsList) return;

    if (!sessionIsOwner && !sessionIsModerator) {
        window.location.href = "/";
        return;
    }

    let adminActionPendingLocked = false;
    const adminAchievementKeysByUserId = new Map();
    let latestDecisionShownId = readAdminDecisionSeenId();

    const userFeedbackElementId = (userId) => `adminUserFeedback-${Number(userId) || 0}`;
    const setAdminUserFeedback = (userId, message, type = "error") => {
        setFeedback(userFeedbackElementId(userId), message, type);
    };
    const clearAdminUserFeedback = (userId) => {
        setFeedback(userFeedbackElementId(userId), "", "");
    };
    const clearAllAdminUserFeedback = () => {
        adminPanel.querySelectorAll(".admin-user-feedback").forEach((element) => {
            setFeedback(element, "", "");
        });
    };

    const applyAdminListVisibleLimit = (container, maxVisibleItems) => {
        if (!(container instanceof HTMLElement)) return;
        const children = Array.from(container.children).filter((child) => child instanceof HTMLElement);
        const limit = Number(maxVisibleItems) || 0;

        if (!children.length || limit <= 0 || children.length <= limit) {
            container.style.maxHeight = "";
            container.style.overflowY = "";
            container.style.paddingRight = "";
            return;
        }

        const styles = window.getComputedStyle(container);
        const rowGap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
        const visibleItems = children.slice(0, limit);
        const visibleHeight = visibleItems.reduce(
            (total, item) => total + item.getBoundingClientRect().height,
            0
        );
        const maxHeight = visibleHeight + (rowGap * Math.max(0, visibleItems.length - 1));

        container.style.maxHeight = `${Math.ceil(maxHeight + 1)}px`;
        container.style.overflowY = "auto";
        container.style.paddingRight = "0.2rem";
    };

    const updateAdminListVisibleLimits = () => {
        applyAdminListVisibleLimit(adminOwnerRequestsList, 2);
        applyAdminListVisibleLimit(adminSuggestionsList, 2);
        applyAdminListVisibleLimit(adminRoundsList, 2);
        applyAdminListVisibleLimit(adminUsersList, 2);
    };

    let adminListResizeFrame = 0;
    const handleAdminResize = () => {
        if (adminListResizeFrame) cancelAnimationFrame(adminListResizeFrame);
        adminListResizeFrame = requestAnimationFrame(() => {
            adminListResizeFrame = 0;
            updateAdminListVisibleLimits();
        });
    };

    window.addEventListener("resize", handleAdminResize);
    window.addEventListener("beforeunload", () => {
        window.removeEventListener("resize", handleAdminResize);
        if (adminListResizeFrame) cancelAnimationFrame(adminListResizeFrame);
    }, { once: true });

    function rememberLatestModeratorDecision(decisionId) {
        const parsed = Number(decisionId || 0);
        if (!parsed) return;
        latestDecisionShownId = Math.max(latestDecisionShownId, parsed);
        writeAdminDecisionSeenId(latestDecisionShownId);
        syncAdminNotificationDotByResolvedId(adminLatestResolvedDecisionId);
    }

    function ensureModeratorDecisionModal() {
        let modal = byId("adminDecisionModal");
        if (modal) return modal;
        modal = document.createElement("div");
        modal.id = "adminDecisionModal";
        modal.className = "modal hidden";
        modal.innerHTML = `
            <div class="modal-card admin-decision-modal-card">
                <h2 id="adminDecisionTitle">Solicitação processada</h2>
                <p id="adminDecisionSummary" class="feedback warn"></p>
                <div id="adminDecisionDetails" class="admin-decision-details"></div>
                <div class="inline-actions">
                    <button id="adminDecisionOkBtn" class="btn" type="button">Ok</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const okBtn = byId("adminDecisionOkBtn");
        okBtn?.addEventListener("click", () => {
            const decisionId = Number(modal.dataset.decisionId || 0);
            if (decisionId) rememberLatestModeratorDecision(decisionId);
            modal.classList.add("hidden");
        });
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                const decisionId = Number(modal.dataset.decisionId || 0);
                if (decisionId) rememberLatestModeratorDecision(decisionId);
                modal.classList.add("hidden");
            }
        });
        return modal;
    }

    function syncModeratorDecisionNotice(latestResolvedAdminAction) {
        if (!sessionIsModerator || sessionIsOwner) return;
        const decision = latestResolvedAdminAction && typeof latestResolvedAdminAction === "object"
            ? latestResolvedAdminAction
            : null;
        if (!decision) return;
        const decisionId = Number(decision.id || 0);
        syncAdminNotificationDotByResolvedId(decisionId);
        if (!decisionId || decisionId <= latestDecisionShownId) return;

        const modal = ensureModeratorDecisionModal();
        modal.dataset.decisionId = String(decisionId);

        const title = byId("adminDecisionTitle");
        const summary = byId("adminDecisionSummary");
        const details = byId("adminDecisionDetails");
        if (title) title.textContent = `Solicitação ${String(decision.status_label || "processada")}`;
        if (summary) {
            const summaryText = decision.result_message
                || `${String(decision.action_label || "Ação administrativa")} foi ${String(decision.status_label || "processada").toLowerCase()}.`;
            summary.textContent = summaryText;
            summary.className = `feedback ${String(decision.status || "").toLowerCase() === "approved" ? "ok" : "warn"}`;
        }
        if (details) {
            const items = [];
            items.push(`<li><strong>Ação:</strong> ${escapeHtml(String(decision.action_label || "-"))}</li>`);
            items.push(`<li><strong>Status:</strong> ${escapeHtml(String(decision.status_label || "-"))}</li>`);
            if (Number(decision.created_at) > 0) {
                items.push(`<li><strong>Criada em:</strong> ${escapeHtml(formatRoundDateTime(decision.created_at))}</li>`);
            }
            if (Number(decision.decided_at) > 0) {
                items.push(`<li><strong>Decidida em:</strong> ${escapeHtml(formatRoundDateTime(decision.decided_at))}</li>`);
            }
            const detailLines = Array.isArray(decision.detail_lines) ? decision.detail_lines : [];
            detailLines.forEach((line) => {
                items.push(`<li>${escapeHtml(String(line || ""))}</li>`);
            });
            details.innerHTML = `<ul>${items.join("")}</ul>`;
        }
        modal.classList.remove("hidden");
    }

    function syncAdminHeader() {
        const title = adminPanel.querySelector("h1");
        if (!title) return;
        title.textContent = sessionIsOwner ? "Painel do Dono" : "Painel do Moderador";
    }

    async function refreshAdmin() {
        const data = await sendJson("/api/admin/dashboard");
        const userAchievementsMap = new Map(
            (data.userAchievements || []).map((item) => [
                Number(item.user_id),
                {
                    unlocked_count: Number(item.unlocked_count || 0),
                    keys: parseAchievementKeys(item.keys)
                }
            ])
        );
        adminAchievementKeysByUserId.clear();
        userAchievementsMap.forEach((value, userId) => {
            adminAchievementKeysByUserId.set(Number(userId), Array.isArray(value?.keys) ? value.keys : []);
        });
        userRoleMapById.clear();
        (data.users || []).forEach((user) => {
            const id = Number(user?.id || 0);
            if (!id) return;
            userRoleMapById.set(id, {
                role: normalizeRole(user?.role),
                is_owner: Boolean(user?.is_owner),
                is_moderator: Boolean(user?.is_moderator)
            });
        });
        adminUsersList.innerHTML = renderAdminDashboardUsers(data.users, userAchievementsMap);
        adminRoundsList.innerHTML = renderAdminDashboardRounds(data.rounds);
        if (adminOwnerRequestsCard && adminOwnerRequestsList) {
            if (sessionIsOwner) {
                const ownerRequests = Array.isArray(data?.pendingOwnerActionRequests) ? data.pendingOwnerActionRequests : [];
                adminOwnerRequestsList.innerHTML = renderAdminOwnerActionRequests(ownerRequests);
                adminOwnerRequestsCard.classList.toggle("hidden", ownerRequests.length === 0);
                setAdminNotificationDotVisible(ownerRequests.length > 0);
                if (ownerRequests.length > 0) {
                    setFeedback("adminFeedback", "Você tem solicitações pendentes para permitir ou negar.", "warn");
                }
            } else {
                adminOwnerRequestsList.innerHTML = "";
                adminOwnerRequestsCard.classList.add("hidden");
            }
        }
        if (adminSuggestionsCard && adminSuggestionsList) {
            if (sessionIsOwner) {
                const ownerSuggestions = Array.isArray(data?.ownerSuggestions) ? data.ownerSuggestions : [];
                adminSuggestionsList.innerHTML = renderAdminSuggestions(ownerSuggestions);
                adminSuggestionsCard.classList.remove("hidden");
            } else {
                adminSuggestionsList.innerHTML = "";
                adminSuggestionsCard.classList.add("hidden");
            }
        }
        updateAdminListVisibleLimits();
        clearAllAdminUserFeedback();
        adminActionPendingLocked = Boolean(data?.pendingAdminAction) && sessionIsModerator && !sessionIsOwner;
        if (adminActionPendingLocked) {
            setFeedback("adminFeedback", "Você tem uma solicitação pendente. Aguarde aprovação do dono para continuar.", "warn");
        }
        syncModeratorDecisionNotice(data?.latestResolvedAdminAction);
        syncAdminHeader();
    }

    const ensureNotLocked = () => {
        if (adminActionPendingLocked && sessionIsModerator && !sessionIsOwner) {
            throw new Error("Há uma solicitação pendente. Aguarde o dono permitir ou negar.");
        }
    };

    const handleAdminResult = async (result, options = {}) => {
        const pending = Boolean(result?.pendingApproval);
        const message = result?.message || (pending ? "Solicitação enviada." : "Ação realizada.");
        const type = pending ? "warn" : "ok";
        setFeedback(
            "adminFeedback",
            options.globalMessage || "",
            options.globalMessageType || ""
        );
        if (pending) adminActionPendingLocked = true;
        await refreshAdmin();
        if (options.userId) {
            setAdminUserFeedback(options.userId, message, type);
            return;
        }
        if (options.roundId) {
            setFeedback("adminFeedback", message, type);
            return;
        }
        setFeedback("adminFeedback", message, type);
    };

    const toggleAchievementMoreOptions = (userId) => {
        const numericUserId = Number(userId || 0);
        if (!numericUserId) return;
        const toggleBtn = adminPanel.querySelector(`[data-admin-toggle-achievement-options="${numericUserId}"]`);
        const optionsWrap = adminPanel.querySelector(`div[data-admin-achievement-more-options="${numericUserId}"]`);
        if (!toggleBtn || !optionsWrap) return;
        const expanded = String(toggleBtn.dataset.adminAchievementOptionsExpanded || "0") === "1";
        const nextExpanded = !expanded;
        toggleBtn.dataset.adminAchievementOptionsExpanded = nextExpanded ? "1" : "0";
        toggleBtn.textContent = nextExpanded ? "Menos opções" : "Mais opções";
        optionsWrap.classList.toggle("hidden", !nextExpanded);
    };

    try {
        await refreshAdmin();
    } catch (error) {
        setFeedback("adminFeedback", error.message, "error");
    }

    adminPanel.addEventListener("click", async (event) => {
        const ownerDecisionBtn = event.target.closest("button[data-admin-owner-request-decision][data-admin-owner-request-id]");
        const toggleBtn = event.target.closest("button[data-admin-toggle-block]");
        const deleteUserBtn = event.target.closest("button[data-admin-delete-user]");
        const closeRoundBtn = event.target.closest("button[data-admin-close-round]");
        const deleteRoundBtn = event.target.closest("button[data-admin-delete-round]");
        const grantAchievementBtn = event.target.closest("button[data-admin-grant-achievement]");
        const revokeAchievementBtn = event.target.closest("button[data-admin-revoke-achievement]");
        const resetAchievementsBtn = event.target.closest("button[data-admin-reset-achievements]");
        const toggleAchievementOptionsBtn = event.target.closest("[data-admin-toggle-achievement-options]");
        const roleBtn = event.target.closest("button[data-admin-set-role]");
        const deleteSuggestionBtn = event.target.closest("button[data-admin-delete-suggestion]");

        if (toggleAchievementOptionsBtn) {
            const userId = Number(toggleAchievementOptionsBtn.dataset.adminToggleAchievementOptions || 0);
            toggleAchievementMoreOptions(userId);
            return;
        }

        let feedbackUserId = 0;
        try {
            if (ownerDecisionBtn) {
                if (!sessionIsOwner) return;
                const requestId = Number(ownerDecisionBtn.dataset.adminOwnerRequestId || 0);
                const decision = String(ownerDecisionBtn.dataset.adminOwnerRequestDecision || "").trim().toLowerCase();
                if (!requestId || !["allow", "deny"].includes(decision)) {
                    throw new Error("Solicitação inválida.");
                }
                const result = await withButtonLoading(
                    ownerDecisionBtn,
                    decision === "allow" ? "Permitindo..." : "Negando...",
                    () => sendJson(`/api/admin/action-requests/${requestId}/decision`, "POST", { decision })
                );
                await handleAdminResult(result, {
                    globalMessage: result?.message || "Solicitação processada.",
                    globalMessageType: decision === "allow" ? "ok" : "warn"
                });
                return;
            }
            if (toggleBtn) {
                const userId = Number(toggleBtn.dataset.adminToggleBlock);
                feedbackUserId = userId;
                clearAdminUserFeedback(userId);
                ensureNotLocked();
                const blocked = Number(toggleBtn.dataset.adminBlocked) === 1 ? 0 : 1;
                const result = await withButtonLoading(toggleBtn, "Salvando...", () =>
                    sendJson(`/api/admin/users/${userId}/block`, "PATCH", { blocked })
                );
                await handleAdminResult(result, { userId });
                return;
            }
            if (deleteUserBtn) {
                const userId = Number(deleteUserBtn.dataset.adminDeleteUser);
                feedbackUserId = userId;
                clearAdminUserFeedback(userId);
                ensureNotLocked();
                const accountName = String(deleteUserBtn.dataset.adminDeleteUserName || "conta sem nome").trim();
                const confirmed = window.confirm(`Confirmar a exclusão da conta (${accountName})?`);
                if (!confirmed) return;
                const result = await withButtonLoading(deleteUserBtn, "Excluindo...", () =>
                    sendJson(`/api/admin/users/${userId}`, "DELETE")
                );
                await handleAdminResult(result, { userId });
                return;
            }
            if (closeRoundBtn) {
                ensureNotLocked();
                const roundId = Number(closeRoundBtn.dataset.adminCloseRound);
                const result = await withButtonLoading(closeRoundBtn, "Fechando...", () =>
                    sendJson(`/api/admin/rounds/${roundId}/close`, "POST", {})
                );
                await handleAdminResult(result, { roundId });
                return;
            }
            if (deleteRoundBtn) {
                ensureNotLocked();
                const roundId = Number(deleteRoundBtn.dataset.adminDeleteRound);
                const roundLabel = String(deleteRoundBtn.dataset.adminDeleteRoundLabel || `Rodada #${roundId}`).trim();
                const confirmed = window.confirm(`Confirmar exclusão da ${roundLabel}?`);
                if (!confirmed) return;
                const result = await withButtonLoading(deleteRoundBtn, "Excluindo...", () =>
                    sendJson(`/api/admin/rounds/${roundId}`, "DELETE")
                );
                await handleAdminResult(result, { roundId });
                return;
            }
            if (grantAchievementBtn) {
                const userId = Number(grantAchievementBtn.dataset.adminGrantAchievement);
                feedbackUserId = userId;
                clearAdminUserFeedback(userId);
                ensureNotLocked();
                const select = adminPanel.querySelector(`select[data-admin-achievement-key='${userId}']`);
                const achievementKey = String(select?.value || "").trim();
                if (!achievementKey) throw new Error("Selecione uma conquista.");
                const result = await withButtonLoading(grantAchievementBtn, "Enviando...", () =>
                    sendJson(`/api/admin/users/${userId}/achievements`, "POST", {
                        action: "grant",
                        achievementKey
                    })
                );
                await handleAdminResult(result, { userId });
                return;
            }
            if (revokeAchievementBtn) {
                const userId = Number(revokeAchievementBtn.dataset.adminRevokeAchievement);
                feedbackUserId = userId;
                clearAdminUserFeedback(userId);
                ensureNotLocked();
                const select = adminPanel.querySelector(`select[data-admin-achievement-key='${userId}']`);
                const achievementKey = String(select?.value || "").trim();
                if (!achievementKey) throw new Error("Selecione uma conquista.");
                const ownedAchievements = adminAchievementKeysByUserId.get(userId) || [];
                if (!ownedAchievements.includes(achievementKey)) {
                    throw new Error("Conquista inexistente.");
                }
                const result = await withButtonLoading(revokeAchievementBtn, "Enviando...", () =>
                    sendJson(`/api/admin/users/${userId}/achievements`, "POST", {
                        action: "revoke",
                        achievementKey
                    })
                );
                await handleAdminResult(result, { userId });
                return;
            }
            if (resetAchievementsBtn) {
                const userId = Number(resetAchievementsBtn.dataset.adminResetAchievements);
                feedbackUserId = userId;
                clearAdminUserFeedback(userId);
                ensureNotLocked();
                const confirmed = window.confirm("Tem certeza que deseja zerar todas as conquistas desta conta?");
                if (!confirmed) return;
                const result = await withButtonLoading(resetAchievementsBtn, "Enviando...", () =>
                    sendJson(`/api/admin/users/${userId}/achievements`, "POST", {
                        action: "reset_all"
                    })
                );
                await handleAdminResult(result, { userId });
                return;
            }
            if (roleBtn) {
                const userId = Number(roleBtn.dataset.adminSetRole);
                feedbackUserId = userId;
                clearAdminUserFeedback(userId);
                ensureNotLocked();
                const role = normalizeRole(roleBtn.dataset.adminTargetRole);
                const result = await withButtonLoading(roleBtn, "Salvando...", () =>
                    sendJsonWithFallback([
                        {
                            url: `/api/admin/users/${userId}/role`,
                            method: "PATCH",
                            payload: { role }
                        },
                        {
                            url: `/api/admin/users/${userId}/moderator`,
                            method: "PATCH",
                            payload: { moderator: role === "moderator" }
                        },
                        {
                            url: `/api/admin/users/${userId}/moderator`,
                            method: "POST",
                            payload: { moderator: role === "moderator" }
                        }
                    ])
                );
                await handleAdminResult(result, { userId });
                return;
            }
            if (deleteSuggestionBtn) {
                if (!sessionIsOwner) return;
                const suggestionId = Number(deleteSuggestionBtn.dataset.adminDeleteSuggestion || 0);
                if (!suggestionId) throw new Error("Sugestão inválida.");
                const result = await withButtonLoading(deleteSuggestionBtn, "Excluindo...", () =>
                    sendJson(`/api/admin/suggestions/${suggestionId}`, "DELETE")
                );
                await refreshAdmin();
                setFeedback("adminFeedback", result?.message || "Sugestão excluída.", "ok");
            }
        } catch (error) {
            if (feedbackUserId > 0) {
                setAdminUserFeedback(feedbackUserId, error.message, "error");
            } else {
                setFeedback("adminFeedback", error.message, "error");
            }
        }
    });

    adminPanel.addEventListener("keydown", (event) => {
        const trigger = event.target.closest("[data-admin-toggle-achievement-options]");
        if (!trigger) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const userId = Number(trigger.dataset.adminToggleAchievementOptions || 0);
        toggleAchievementMoreOptions(userId);
    });

    let adminEventRefreshQueued = false;
    const handleAdminChangeEvent = () => {
        if (adminEventRefreshQueued) return;
        adminEventRefreshQueued = true;
        window.setTimeout(async () => {
            adminEventRefreshQueued = false;
            try {
                await refreshAdmin();
            } catch {
                // atualizacao por evento falhou; proxima mudanca tenta novamente
            }
        }, 80);
    };
    window.addEventListener("clubedojogo:admin-change", handleAdminChangeEvent);
    window.addEventListener("beforeunload", () => {
        window.removeEventListener("clubedojogo:admin-change", handleAdminChangeEvent);
    }, { once: true });
}

async function submitRecommendationCommentForm(form, scope, feedbackTarget) {
    if (!(form instanceof HTMLFormElement)) return false;
    const recommendationId = Number(form.dataset.commentForm || 0);
    if (!recommendationId) return false;

    const input = form.querySelector("input[name='commentText']");
    const commentText = String(input?.value || "").trim();
    if (!commentText) return true;

    const parentInput = form.querySelector("input[name='parentCommentId']");
    const parentCommentId = Number(parentInput?.value || 0);
    const editCommentId = Number(form.dataset.editCommentId || 0);
    try {
        if (editCommentId > 0) {
            const result = await sendJson(`/api/recommendation-comments/${editCommentId}`, "PUT", { commentText });
            const recommendation = upsertRecommendationComment(scope, recommendationId, result.comment);
            syncRecommendationCommentList(recommendation, scope, true);
        } else {
            const payload = parentCommentId > 0 ? { commentText, parentCommentId } : { commentText };
            const result = await sendJson(`/api/recommendations/${recommendationId}/comments`, "POST", payload);
            const recommendation = upsertRecommendationComment(scope, recommendationId, result.comment);
            syncRecommendationCommentList(recommendation, scope, true);
        }
        form.reset();
        resetCommentFormState(recommendationId);
    } catch (error) {
        setFeedback(feedbackTarget, error.message, "error");
    }
    return true;
}

async function handleRecommendationCommentAction(event, scope, feedbackTarget) {
    const cancelBtn = event.target.closest("button[data-comment-context-cancel]");
    if (cancelBtn) {
        const recommendationId = Number(cancelBtn.dataset.commentContextCancel || 0);
        if (recommendationId) {
            resetCommentFormState(recommendationId);
            const form = document.querySelector(`form[data-comment-form="${recommendationId}"]`);
            const input = form?.querySelector("input[name='commentText']");
            if (input instanceof HTMLInputElement) input.value = "";
        }
        return true;
    }

    const likeToggleBtn = event.target.closest("button[data-comment-like-toggle][data-comment-id][data-recommendation-id]");
    if (likeToggleBtn) {
        const recommendationId = Number(likeToggleBtn.dataset.recommendationId || 0);
        const commentId = Number(likeToggleBtn.dataset.commentId || 0);
        const recommendation = getRecommendationByScope(scope, recommendationId);
        const comment = findCommentById(recommendation, commentId);
        if (!recommendation || !comment) return true;
        try {
            const result = await sendJson(`/api/recommendation-comments/${commentId}/like`, "POST", {});
            const updatedRecommendation = upsertRecommendationComment(scope, recommendationId, result.comment || {
                ...comment,
                likes_count: Number(result?.likesCount || 0),
                liked_by_me: result?.liked ? 1 : 0
            });
            syncRecommendationCommentList(updatedRecommendation, scope, true);
            if (scope === "home") scheduleHomeCommentFormAlignment();
        } catch (error) {
            setFeedback(feedbackTarget, error.message, "error");
        }
        return true;
    }

    const likeListBtn = event.target.closest("button[data-comment-like-list][data-comment-id][data-recommendation-id]");
    if (likeListBtn) {
        await showCommentLikesPopup("recommendation", Number(likeListBtn.dataset.commentId || 0), likeListBtn);
        return true;
    }

    const actionBtn = event.target.closest("button[data-comment-action][data-comment-id][data-recommendation-id]");
    if (!actionBtn) return false;

    const action = String(actionBtn.dataset.commentAction || "");
    const recommendationId = Number(actionBtn.dataset.recommendationId || 0);
    const commentId = Number(actionBtn.dataset.commentId || 0);
    const recommendation = getRecommendationByScope(scope, recommendationId);
    const comment = findCommentById(recommendation, commentId);
    if (!recommendation || !comment) return true;

    const form = document.querySelector(`form[data-comment-form="${recommendationId}"]`);
    const input = form?.querySelector("input[name='commentText']");

    if (action === "reply") {
        setCommentFormState(recommendationId, {
            mode: "reply",
            parentCommentId: commentId,
            label: `a ${displayName(comment)}`
        });
        if (input instanceof HTMLInputElement) input.focus();
        return true;
    }

    if (action === "edit") {
        setCommentFormState(recommendationId, {
            mode: "edit",
            commentId,
            label: ""
        });
        if (input instanceof HTMLInputElement) {
            input.value = String(comment.comment_text || "");
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
        return true;
    }

    if (action === "delete") {
        try {
            await fetch(`/api/recommendation-comments/${commentId}`, {
                method: "DELETE",
                credentials: "include"
            }).then(async (response) => {
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.message || "Erro ao excluir comentário.");
            });
            const updatedRecommendation = removeRecommendationComment(scope, recommendationId, commentId);
            syncRecommendationCommentList(updatedRecommendation, scope, true);
            if (getCommentFormState(recommendationId).commentId === commentId) {
                resetCommentFormState(recommendationId);
                if (input instanceof HTMLInputElement) input.value = "";
            }
            if (scope === "home") scheduleHomeCommentFormAlignment();
        } catch (error) {
            setFeedback(feedbackTarget, error.message, "error");
        }
        return true;
    }

    return false;
}

function setFeedback(target, message, type = "error") {
    const el = typeof target === "string" ? byId(target) : target;
    if (!el) return;
    const text = normalizeTextArtifacts(message).trim();
    el.textContent = text;
    el.classList.add("feedback");
    el.classList.remove("ok", "error", "warn");
    if (text && type) {
        el.classList.add(type);
    }
    if (!text) {
        el.classList.add("hidden");
    } else {
        el.classList.remove("hidden");
    }
}

function setFieldFeedback(form, fieldName, message, type = "error") {
    if (!(form instanceof HTMLFormElement) || !fieldName) return;
    const slot = form.querySelector(`[data-field-feedback-for="${fieldName}"]`);
    if (!(slot instanceof HTMLElement)) return;
    const text = normalizeTextArtifacts(message).trim();
    slot.textContent = text;
    slot.classList.add("field-feedback");
    slot.classList.remove("ok", "error", "warn");
    if (text && type) {
        slot.classList.add(type);
    }
    if (!text) {
        slot.classList.add("hidden");
    } else {
        slot.classList.remove("hidden");
    }
}

function clearFieldFeedback(form, fieldName) {
    setFieldFeedback(form, fieldName, "", "");
}

function clearAllFieldFeedback(form) {
    if (!(form instanceof HTMLFormElement)) return;
    form.querySelectorAll("[data-field-feedback-for]").forEach((slot) => {
        if (!(slot instanceof HTMLElement)) return;
        const fieldName = String(slot.dataset.fieldFeedbackFor || "");
        if (!fieldName) return;
        clearFieldFeedback(form, fieldName);
    });
}

function bindFieldFeedbackAutoClear(form) {
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.fieldFeedbackBound === "1") return;
    form.dataset.fieldFeedbackBound = "1";

    form.querySelectorAll("[data-field-feedback-for]").forEach((slot) => {
        const fieldName = String(slot.getAttribute("data-field-feedback-for") || "");
        if (!fieldName) return;
        const control = form.elements?.[fieldName];
        if (!control) return;

        const controls = (() => {
            if (typeof RadioNodeList !== "undefined" && control instanceof RadioNodeList) {
                return [...control].filter((item) => item instanceof HTMLElement);
            }
            return control instanceof HTMLElement ? [control] : [];
        })();

        controls.forEach((item) => {
            if (item.dataset.fieldFeedbackClearBound === "1") return;
            item.dataset.fieldFeedbackClearBound = "1";
            item.addEventListener("input", () => clearFieldFeedback(form, fieldName));
            item.addEventListener("change", () => clearFieldFeedback(form, fieldName));
        });
    });
}

function mapRegisterErrorToField(message) {
    const lower = String(message || "").toLowerCase();
    if (!lower) return "";
    if (lower.includes("nickname")) return "nickname";
    if (lower.includes("confirmação de senha") || lower.includes("confirme a senha")) return "confirmPassword";
    if (lower.includes("senha precisa")) return "password";
    if (lower.includes("email inválido")) return "email";
    if (lower.includes("nome de usuário inválido")) return "username";
    if (lower.includes("email ou nome de usuário")) return "email_or_username";
    return "";
}

function mapResetPasswordErrorToField(message) {
    const lower = String(message || "").toLowerCase();
    if (!lower) return "";
    if (lower.includes("confirmação de senha") || lower.includes("confirme a senha")) return "confirmPassword";
    if (lower.includes("senha precisa")) return "password";
    return "";
}

function ensureAchievementToastStack() {
    let stack = byId("achievementToastStack");
    if (stack) return stack;
    stack = document.createElement("div");
    stack.id = "achievementToastStack";
    stack.className = "achievement-toast-stack";
    document.body.appendChild(stack);
    return stack;
}

function playAchievementUnlockSound() {
    if (!achievementSound) {
        achievementSound = new Audio("/uploads/trofeus/som.ogg");
    }
    achievementSound.currentTime = 0;
    achievementSound.play().catch(() => {
        // navegadores podem bloquear autoplay sem gesto
    });
}

function showAchievementUnlockNotification(achievement) {
    const stack = ensureAchievementToastStack();
    const existingToasts = [...stack.querySelectorAll(".achievement-toast")];
    const previousTops = new Map(
        existingToasts.map((item) => [item, item.getBoundingClientRect().top])
    );
    const description = String(achievement?.description || "").trim();

    const toast = document.createElement("article");
    toast.className = "achievement-toast";
    toast.innerHTML = `
        <img src="${escapeHtml(achievement.imageUrl || baseAvatar)}" alt="${escapeHtml(achievement.name || "Conquista")}">
        <div>
            <small>Conquista desbloqueada</small>
            <strong>${escapeHtml(achievement.name || "Nova conquista")}</strong>
            ${description ? `<p class="achievement-toast-description">${escapeHtml(description)}</p>` : ""}
        </div>
    `;
    stack.prepend(toast);

    requestAnimationFrame(() => {
        existingToasts.forEach((item) => {
            const previousTop = previousTops.get(item);
            if (!Number.isFinite(previousTop)) return;
            const currentTop = item.getBoundingClientRect().top;
            const delta = previousTop - currentTop;
            if (Math.abs(delta) < 1) return;
            item.style.transition = "none";
            item.style.transform = `translateY(${delta}px)`;
            requestAnimationFrame(() => {
                item.style.transition = "transform 0.35s ease";
                item.style.transform = "translateY(0)";
            });
            item.addEventListener(
                "transitionend",
                () => {
                    item.style.removeProperty("transition");
                    item.style.removeProperty("transform");
                },
                { once: true }
            );
        });
    });

    playAchievementUnlockSound();
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
        toast.classList.remove("is-visible");
        setTimeout(() => toast.remove(), 450);
    }, 10000);
}

function showAchievementUnlockNotifications(achievements) {
    if (!Array.isArray(achievements) || !achievements.length) return;
    const now = Date.now();
    const toastTtlMs = 1000 * 90;

    for (const [key, createdAt] of recentAchievementToastKeys.entries()) {
        if (!Number.isFinite(createdAt) || now - createdAt > toastTtlMs) {
            recentAchievementToastKeys.delete(key);
        }
    }

    const queue = [];
    achievements.forEach((achievement) => {
        const dedupeKey = String(
            achievement?.key
            || achievement?.name
            || `${achievement?.imageUrl || ""}:${achievement?.description || ""}`
        ).trim().toLowerCase();
        if (!dedupeKey) {
            queue.push(achievement);
            return;
        }
        if (recentAchievementToastKeys.has(dedupeKey)) return;
        recentAchievementToastKeys.set(dedupeKey, now);
        queue.push(achievement);
    });

    queue.forEach((achievement, index) => {
        setTimeout(() => showAchievementUnlockNotification(achievement), index * 2000);
    });
}

async function claimAchievementUnlocksAndNotify() {
    if (achievementClaimInFlight) return null;
    achievementClaimInFlight = true;
    try {
        const data = await sendJson("/api/user/achievements?claim=1");
        showAchievementUnlockNotifications(data.newlyUnlocked || []);
        return data;
    } catch {
        return null;
    } finally {
        achievementClaimInFlight = false;
    }
}

function setButtonLoading(button, isLoading, loadingText = "Carregando...") {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent || "";
        }
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");
        button.setAttribute("disabled", "disabled");
        if (loadingText) button.textContent = loadingText;
        return;
    }

    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    button.removeAttribute("disabled");
    if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
    }
}

async function withButtonLoading(button, loadingText, handler) {
    if (!button) return handler();
    setButtonLoading(button, true, loadingText);
    try {
        return await handler();
    } finally {
        setButtonLoading(button, false);
    }
}

function setupGoogleButtonsLoading() {
    const selectors = ["#googleLoginBtn", "#googleRegisterBtn"];
    selectors.forEach((selector) => {
        const link = document.querySelector(selector);
        if (!link) return;
        link.addEventListener("click", () => {
            setButtonLoading(link, true, "Conectando...");
        });
    });
}

async function sendJson(url, method = "GET", payload) {
    const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: payload ? JSON.stringify(payload) : undefined
    });
    const rawData = await response.json().catch(() => ({}));
    const data = normalizePayloadTextArtifacts(rawData);
    if (!response.ok) {
        const error = new Error(normalizeTextArtifacts(data.message || "Erro na requisição."));
        error.statusCode = response.status;
        error.responseData = data;
        throw error;
    }
    return data;
}

async function sendJsonWithFallback(requests) {
    let lastError = null;
    for (const request of requests || []) {
        try {
            return await sendJson(request.url, request.method || "GET", request.payload);
        } catch (error) {
            lastError = error;
            if (Number(error?.statusCode) === 404) continue;
            throw error;
        }
    }
    if (lastError) throw lastError;
    throw new Error("Nenhuma requisição foi informada.");
}

async function sendForm(url, formData) {
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        body: formData
    });
    const rawData = await response.json().catch(() => ({}));
    const data = normalizePayloadTextArtifacts(rawData);
    if (!response.ok) {
        throw new Error(normalizeTextArtifacts(data.message || "Erro na requisição."));
    }
    return data;
}

function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function getResetTokenFromQuery() {
    return getQueryParam("token");
}

function showOAuthFeedbackFromQuery() {
    const error = getQueryParam("error");
    if (!error) return;
    const messages = {
        google_not_configured: "Login Google ainda não foi configurado no servidor.",
        google_auth_failed: "Falha ao autenticar com Google.",
        google_email_unavailable: "Sua conta Google não retornou um email válido.",
        account_blocked: "Conta Bloqueada"
    };
    setFeedback("feedback", messages[error] || "Erro de autenticação.");
}

function recommendationCardTemplate(rec, options = {}) {
    const showGradeOverlay = options.showGradeOverlay !== false;
    const showInlineGrade = options.showInlineGrade === true;
    const isRoundIndicationLayout = options.layout === "round-indication";
    const hasReason = String(rec.reason || "").trim().length > 0;
    const grade = rec.rating_letter && rec.interest_score ? `${rec.rating_letter}${rec.interest_score}` : "";
    const cover = rec.game_cover_url || baseAvatar;
    const commentsHtml = recommendationCommentsHtml(rec.id, rec.comments || [], { interactive: true });
    const cardClass = `recommendation-card${isRoundIndicationLayout ? " recommendation-card-indication" : ""}${hasReason ? "" : " recommendation-card-no-reason"}`;
    const reasonHtml = hasReason
        ? `
            <div class="recommendation-reason-wrap">
                <p class="recommendation-section-label">Motivação</p>
                <p class="recommendation-reason">${escapeHtml(rec.reason)}</p>
            </div>
        `
        : "";

    if (isRoundIndicationLayout) {
        return `
            <article class="${cardClass}" data-recommendation-id="${rec.id}">
                <div class="recommendation-cover-wrap">
                    <img class="recommendation-cover-bg" src="${escapeHtml(cover)}" alt="">
                    <img class="recommendation-cover" src="${escapeHtml(cover)}" alt="Capa ${escapeHtml(rec.game_name)}">
                    ${showGradeOverlay && grade ? `<span class="grade-overlay">${escapeHtml(grade)}</span>` : ""}
                </div>
                <div class="recommendation-indication-main">
                    <div class="recommendation-indication-top">
                        <h3>${escapeHtml(rec.game_name)}</h3>
                        <div class="meta-row">
                            <span class="pill">De: ${userLinkHtml({ nickname: rec.giver_nickname, username: rec.giver_username }, rec.giver_user_id)}</span>
                            <span class="pill">Para: ${userLinkHtml({ nickname: rec.receiver_nickname, username: rec.receiver_username }, rec.receiver_user_id)}</span>
                        </div>
                        <div class="desc-grade-row">
                            ${showInlineGrade && grade ? `<span class="grade-inline">${escapeHtml(grade)}</span>` : ""}
                            <span class="recommendation-section-label">Descrição</span>
                            <p>${escapeHtml(rec.game_description)}</p>
                        </div>
                        ${reasonHtml}
                    </div>
                    <div class="recommendation-comments-shell">
                        <div class="comment-list" id="comment-list-${rec.id}">${commentsHtml || '<div class="comment-item">Sem comentários ainda.</div>'}</div>
                        <div class="comment-context hidden" id="comment-context-${rec.id}"></div>
                        <form class="comment-form" data-comment-form="${rec.id}">
                            <input type="hidden" name="parentCommentId" value="">
                            <input type="text" name="commentText" maxlength="500" placeholder="Comentar esta avaliação">
                            <button class="btn btn-outline" type="submit">Comentar</button>
                        </form>
                    </div>
                </div>
            </article>
        `;
    }

    return `
        <article class="${cardClass}" data-recommendation-id="${rec.id}">
            <div class="recommendation-cover-wrap">
                <img class="recommendation-cover-bg" src="${escapeHtml(cover)}" alt="">
                <img class="recommendation-cover" src="${escapeHtml(cover)}" alt="Capa ${escapeHtml(rec.game_name)}">
                ${showGradeOverlay && grade ? `<span class="grade-overlay">${escapeHtml(grade)}</span>` : ""}
            </div>
            <h3>${escapeHtml(rec.game_name)}</h3>
            <div class="meta-row">
                <span class="pill">De: ${userLinkHtml({ nickname: rec.giver_nickname, username: rec.giver_username }, rec.giver_user_id)}</span>
                <span class="pill">Para: ${userLinkHtml({ nickname: rec.receiver_nickname, username: rec.receiver_username }, rec.receiver_user_id)}</span>
            </div>
            <div class="desc-grade-row">
                ${showInlineGrade && grade ? `<span class="grade-inline">${escapeHtml(grade)}</span>` : ""}
                <span class="recommendation-section-label">Descrição</span>
                <p>${escapeHtml(rec.game_description)}</p>
            </div>
            ${reasonHtml}
            <div class="comment-list" id="comment-list-${rec.id}">${commentsHtml || '<div class="comment-item">Sem comentários ainda.</div>'}</div>
            <div class="comment-context hidden" id="comment-context-${rec.id}"></div>
            <form class="comment-form" data-comment-form="${rec.id}">
                <input type="hidden" name="parentCommentId" value="">
                <input type="text" name="commentText" maxlength="500" placeholder="Comentar esta avaliação">
                <button class="btn btn-outline" type="submit">Comentar</button>
            </form>
        </article>
    `;
}

async function handleLogoutButton() {
    const btn = byId("logoutBtn");
    btn?.addEventListener("click", async () => {
        await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "include"
        });
        window.location.href = "/login.html";
    });
}

async function handleLogin() {
    const form = byId("loginForm");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        const payload = Object.fromEntries(new FormData(form).entries());
        const submitBtn = event.submitter || form.querySelector("button[type='submit']");
        try {
            await withButtonLoading(submitBtn, "Entrando...", async () => {
                await sendJson("/api/auth/login", "POST", payload);
            });
            window.location.href = "/";
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });
}

async function handleRegister() {
    const form = byId("registerForm");
    bindFieldFeedbackAutoClear(form);
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        clearAllFieldFeedback(form);
        const payload = Object.fromEntries(new FormData(form).entries());
        if (String(payload.password || "") !== String(payload.confirmPassword || "")) {
            setFieldFeedback(form, "confirmPassword", "A confirmação de senha não confere.", "error");
            return;
        }
        const submitBtn = event.submitter || form.querySelector("button[type='submit']");
        try {
            await withButtonLoading(submitBtn, "Enviando código...", async () => {
                await sendJson("/api/auth/register", "POST", payload);
            });
            setFeedback("feedback", "Código enviado. Confira seu email e confirme seu cadastro.", "ok");
            setTimeout(() => {
                window.location.href = `/verify-email.html?email=${encodeURIComponent(payload.email)}`;
            }, 900);
        } catch (error) {
            const message = String(error?.message || "Erro interno no cadastro.");
            const mappedField = mapRegisterErrorToField(message);
            if (mappedField === "email_or_username") {
                setFieldFeedback(form, "username", message, "error");
                setFieldFeedback(form, "email", message, "error");
                return;
            }
            if (mappedField) {
                setFieldFeedback(form, mappedField, message, "error");
                return;
            }
            setFeedback("feedback", message, "error");
        }
    });
}

async function handleVerifyEmail() {
    const form = byId("verifyForm");
    const queryEmail = getQueryParam("email");
    if (queryEmail && form?.elements?.email) {
        form.elements.email.value = queryEmail;
    }
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        const payload = Object.fromEntries(new FormData(form).entries());
        const submitBtn = event.submitter || form.querySelector("button[type='submit']");
        try {
            await withButtonLoading(submitBtn, "Confirmando...", async () => {
                await sendJson("/api/auth/verify-email", "POST", payload);
            });
            setFeedback("feedback", "Email confirmado. Agora faca login.", "ok");
            setTimeout(() => {
                window.location.href = "/login.html";
            }, 900);
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });
}
async function handleForgotPassword() {
    const form = byId("forgotPasswordForm");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        const payload = Object.fromEntries(new FormData(form).entries());
        const submitBtn = event.submitter || form.querySelector("button[type='submit']");
        try {
            const result = await withButtonLoading(submitBtn, "Enviando link...", async () =>
                sendJson("/api/auth/request-password-reset", "POST", payload)
            );
            setFeedback("feedback", result.message, "ok");
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });
}

async function handleResetPassword() {
    const token = getResetTokenFromQuery();
    if (!token) {
        setFeedback("feedback", "Token de troca de senha não encontrado.", "error");
        return;
    }

    const form = byId("resetPasswordForm");
    bindFieldFeedbackAutoClear(form);
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        clearAllFieldFeedback(form);
        const payload = Object.fromEntries(new FormData(form).entries());
        if (String(payload.password || "") !== String(payload.confirmPassword || "")) {
            setFieldFeedback(form, "confirmPassword", "A confirmação de senha não confere.", "error");
            return;
        }
        payload.token = token;
        const submitBtn = event.submitter || form.querySelector("button[type='submit']");
        try {
            await withButtonLoading(submitBtn, "Salvando...", async () => {
                await sendJson("/api/auth/reset-password", "POST", payload);
            });
            setFeedback("feedback", "Senha alterada com sucesso.", "ok");
            setTimeout(() => {
                window.location.href = "/login.html";
            }, 900);
        } catch (error) {
            const message = String(error?.message || "Erro ao alterar senha.");
            const mappedField = mapResetPasswordErrorToField(message);
            if (mappedField) {
                setFieldFeedback(form, mappedField, message, "error");
                return;
            }
            setFeedback("feedback", message, "error");
        }
    });
}

async function loadProfile() {
    const form = byId("profileForm");
    const avatarPreview = byId("avatarPreview");
    const avatarInput = byId("avatarInput");
    const avatarSelectBtn = byId("avatarSelectBtn");
    const profileSaveBtn = byId("profileSaveBtn");
    const nicknameFieldWrap = byId("nicknameFieldWrap");
    const checkNicknameBtn = byId("checkNicknameBtn");
    const nicknameCheckFeedback = byId("nicknameCheckFeedback");
    const profileNicknameDisplay = byId("profileNicknameDisplay");
    const emailFieldLabel = byId("emailFieldLabel");
    const profileTitle = byId("profileTitle");
    const profileGivenList = byId("profileGivenList");
    const profileReceivedList = byId("profileReceivedList");
    const profileCommentsList = byId("profileCommentsList");
    const profileCommentContext = byId("profileCommentContext");
    const profileCommentForm = byId("profileCommentForm");
    const profileActivitySection = byId("profileActivitySection");
    const achievementsGrid = byId("achievementsGrid");
    const achievementsProgress = byId("achievementsProgress");
    const viewedUserId = Number(getQueryParam("userId") || 0);
    let currentProfileUserId = 0;
    let ownUserId = 0;
    const profilePageSize = 6;
    const profileActivityPage = {
        given: 1,
        received: 1
    };
    const profileActivityCache = {
        given: [],
        received: []
    };
    let currentNickname = "";
    let nicknameCheckInFlight = false;
    let nicknameAvailabilityState = {
        value: "",
        checked: false,
        available: false
    };
    let pendingAvatarFile = null;
    let pendingAvatarPreviewUrl = "";
    let profileCommentsCache = [];
    let isProfileOwnerSession = false;
    const achievementImageSourceByKey = new Map();
    let profileCommentFormState = {
        mode: "new",
        commentId: 0,
        parentCommentId: 0,
        label: ""
    };
    const defaultEmailLabel = "Email (não editável)";

    function setupAchievementImageProtection() {
        if (!achievementsGrid || achievementsGrid.dataset.achievementImageProtectionBound === "1") return;
        achievementsGrid.dataset.achievementImageProtectionBound = "1";

        achievementsGrid.addEventListener("contextmenu", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.closest(".achievement-item img")) {
                event.preventDefault();
            }
        });

        achievementsGrid.addEventListener("dragstart", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLImageElement)) return;
            if (target.closest(".achievement-item")) {
                event.preventDefault();
            }
        });
    }

    function setAchievementImageByUnlockState(item, key, unlocked, achievement = null) {
        const imageEl = item.querySelector("img");
        if (!(imageEl instanceof HTMLImageElement)) return;
        imageEl.setAttribute("draggable", "false");
        const unlockedSrc = String(achievement?.imageUrl || achievementImageSourceByKey.get(key) || "").trim();

        if (unlocked) {
            if (key && unlockedSrc && unlockedSrc !== lockedAchievementImageDataUri) {
                achievementImageSourceByKey.set(key, unlockedSrc);
            }
            const finalSrc = String(achievementImageSourceByKey.get(key) || "").trim();
            if (finalSrc) {
                imageEl.src = finalSrc;
            }
            const unlockedName = String(achievement?.name || "").trim();
            imageEl.alt = unlockedName ? `Troféu ${unlockedName}` : "Troféu desbloqueado";
            imageEl.removeAttribute("title");
            return;
        }

        const currentSrc = String(imageEl.getAttribute("src") || imageEl.currentSrc || "").trim();
        if (currentSrc !== lockedAchievementImageDataUri) {
            imageEl.src = lockedAchievementImageDataUri;
        }
        imageEl.alt = "Troféu bloqueado";
        imageEl.removeAttribute("title");
    }

    function clearPendingAvatarSelection() {
        pendingAvatarFile = null;
        if (avatarInput) avatarInput.value = "";
        if (pendingAvatarPreviewUrl && pendingAvatarPreviewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(pendingAvatarPreviewUrl);
        }
        pendingAvatarPreviewUrl = "";
    }

    function maskEmailForDisplay(emailText) {
        const email = String(emailText || "").trim();
        if (!email || !email.includes("@")) return email;
        const [localPart, domainPart] = email.split("@");
        if (!localPart || !domainPart) return email;
        if (localPart.length <= 2) {
            return `${localPart[0] || ""}******@${domainPart}`;
        }
        const prefix = localPart.slice(0, Math.min(2, localPart.length));
        const suffix = localPart.length > 4 ? localPart.slice(-2) : localPart.slice(-1);
        return `${prefix}******${suffix}@${domainPart}`;
    }

    function readNicknameInputValue() {
        const raw = String(form?.elements?.nickname?.value || "");
        return raw.trim().slice(0, 30);
    }

    function isSameNicknameAsCurrent(value) {
        return String(value || "").trim().toLowerCase() === String(currentNickname || "").trim().toLowerCase();
    }

    function isNicknameValidatedForSave(candidate) {
        const normalizedCandidate = String(candidate || "").trim().toLowerCase();
        const normalizedChecked = String(nicknameAvailabilityState.value || "").trim().toLowerCase();
        if (!normalizedCandidate) return false;
        if (isSameNicknameAsCurrent(normalizedCandidate)) return true;
        return nicknameAvailabilityState.checked
            && nicknameAvailabilityState.available
            && normalizedCandidate === normalizedChecked;
    }

    function syncProfileSaveButtonState() {
        if (!profileSaveBtn) return;
        if (!nicknameFieldWrap || nicknameFieldWrap.classList.contains("hidden")) {
            profileSaveBtn.removeAttribute("disabled");
            return;
        }
        if (nicknameCheckInFlight) {
            profileSaveBtn.setAttribute("disabled", "disabled");
            return;
        }
        profileSaveBtn.removeAttribute("disabled");
    }

    function syncNicknameCheckButtonState() {
        if (!checkNicknameBtn || !nicknameFieldWrap || nicknameFieldWrap.classList.contains("hidden")) return;
        const candidate = readNicknameInputValue();
        const shouldDisable = !candidate || isSameNicknameAsCurrent(candidate) || nicknameCheckInFlight;
        if (shouldDisable) checkNicknameBtn.setAttribute("disabled", "disabled");
        else checkNicknameBtn.removeAttribute("disabled");
        checkNicknameBtn.classList.toggle("nickname-check-ready", !shouldDisable);
        syncProfileSaveButtonState();
    }

    async function requestNicknameAvailability(nicknameCandidate) {
        const candidate = String(nicknameCandidate || "").trim().slice(0, 30);
        if (!candidate) {
            return {
                nickname: candidate,
                available: false,
                sameAsCurrent: false,
                message: "Informe um nickname para verificar."
            };
        }
        if (isSameNicknameAsCurrent(candidate)) {
            return {
                nickname: candidate,
                available: true,
                sameAsCurrent: true,
                message: "Esse já é o seu nickname atual."
            };
        }

        // Verificação por busca de usuários (evita 404 quando o endpoint dedicado não existe no servidor em execução).
        const usersPayload = await sendJson(`/api/users?term=${encodeURIComponent(candidate)}`);
        const users = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
        const normalizedCandidate = candidate.toLowerCase();
        const inUse = users.some((user) => {
            if (Number(user?.id) === Number(ownUserId)) return false;
            const normalizedUsername = String(user?.username || "").trim().toLowerCase();
            const normalizedNickname = String(user?.nickname || "").trim().toLowerCase();
            return normalizedUsername === normalizedCandidate || normalizedNickname === normalizedCandidate;
        });

        return {
            nickname: candidate,
            available: !inUse,
            sameAsCurrent: false,
            message: inUse ? "Nickname já está em uso." : "Nickname disponível."
        };
    }

    function activityCardHtml(item, mode) {
        const who = mode === "given"
            ? `Para: ${userLinkHtml({ nickname: item.receiver_nickname, username: item.receiver_username }, item.receiver_id)}`
            : `De: ${userLinkHtml({ nickname: item.giver_nickname, username: item.giver_username }, item.giver_id)}`;
        const grade = item.rating_letter && item.interest_score ? `${item.rating_letter}${item.interest_score}` : "Sem nota";
        const cover = item.game_cover_url || baseAvatar;
        const gradeClass = item.rating_letter && item.interest_score
            ? "grade-inline"
            : "grade-inline grade-inline-muted";
        const reasonHtml = item.reason
            ? `
                <div class="recommendation-reason-wrap">
                    <p class="recommendation-section-label">Motivação</p>
                    <p class="recommendation-reason">${escapeHtml(item.reason)}</p>
                </div>
            `
            : "";
        return `
            <article class="recommendation-card recommendation-card-indication recommendation-card-profile-activity">
                <div class="recommendation-cover-wrap">
                    <img class="recommendation-cover-bg" src="${escapeHtml(cover)}" alt="">
                    <img class="recommendation-cover" src="${escapeHtml(cover)}" alt="Capa ${escapeHtml(item.game_name)}">
                    ${item.rating_letter && item.interest_score ? `<span class="grade-overlay">${escapeHtml(grade)}</span>` : ""}
                </div>
                <div class="recommendation-indication-main">
                    <div class="recommendation-indication-top">
                        <h3>${escapeHtml(item.game_name)}</h3>
                        <div class="meta-row">
                            <span class="pill">${who}</span>
                            <span class="pill">Rodada: ${escapeHtml(formatRoundDateTime(item.created_at))}</span>
                        </div>
                        <div class="desc-grade-row">
                            <span class="${gradeClass}">${escapeHtml(grade)}</span>
                            <span class="recommendation-section-label">Descrição</span>
                            <p>${escapeHtml(item.game_description || "")}</p>
                        </div>
                        ${reasonHtml}
                    </div>
                </div>
            </article>
        `;
    }

    function renderProfileListWithPagination(listEl, items, mode) {
        if (!listEl) return;
        const totalPages = Math.max(1, Math.ceil(items.length / profilePageSize));
        const currentPage = Math.min(totalPages, Math.max(1, profileActivityPage[mode] || 1));
        profileActivityPage[mode] = currentPage;
        const start = (currentPage - 1) * profilePageSize;
        const pageItems = items.slice(start, start + profilePageSize);
        const cards = pageItems.length
            ? pageItems.map((item) => activityCardHtml(item, mode)).join("")
            : mode === "given"
                ? "<p>Nenhuma indicação feita ainda.</p>"
                : "<p>Nenhuma indicação recebida ainda.</p>";
        const pagination = items.length > profilePageSize
            ? `
                <div class="pagination-controls">
                    <button class="btn btn-outline" type="button" data-profile-page-mode="${mode}" data-profile-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
                    <span>Página ${currentPage} de ${totalPages}</span>
                    <button class="btn btn-outline" type="button" data-profile-page-mode="${mode}" data-profile-page-action="next" ${currentPage >= totalPages ? "disabled" : ""}>Próxima</button>
                </div>
              `
            : "";
        listEl.innerHTML = `${cards}${pagination}`;
    }

    function renderProfileActivity(activity) {
        if (!profileGivenList || !profileReceivedList) return;
        profileActivityCache.given = activity?.given || [];
        profileActivityCache.received = activity?.received || [];
        renderProfileListWithPagination(profileGivenList, profileActivityCache.given, "given");
        renderProfileListWithPagination(profileReceivedList, profileActivityCache.received, "received");
    }

    function getProfileCommentById(commentId) {
        const numericId = Number(commentId || 0);
        if (!numericId) return null;
        return profileCommentsCache.find((item) => Number(item.id) === numericId) || null;
    }

    function canEditProfileComment(comment) {
        return sessionUserId > 0 && Number(comment?.user_id) === Number(sessionUserId);
    }

    function canDeleteProfileComment(comment) {
        if (!comment) return false;
        return canEditProfileComment(comment) || isProfileOwnerSession;
    }

    function profileCommentItemHtml(comment, options = {}) {
        const depth = Math.max(0, Math.min(4, Number(options.depth || 0)));
        const parentAuthor = String(options.parentAuthor || "").trim();
        const commentId = Number(comment.id) || 0;
        const canReply = sessionUserId > 0;
        const canEdit = canEditProfileComment(comment);
        const canDelete = canDeleteProfileComment(comment);
        const replyTarget = parentAuthor ? `<span class="comment-reply-to">@${escapeHtml(parentAuthor)}</span>` : "";
        const actions = (canReply || canEdit || canDelete)
            ? `
                <div class="comment-actions">
                    ${commentLikeActionsHtml(comment, { likeScope: "profile" })}
                    ${canReply ? `<button class="comment-action" type="button" data-profile-comment-action="reply" data-profile-comment-id="${commentId}">Responder</button>` : ""}
                    ${canEdit ? `<button class="comment-action" type="button" data-profile-comment-action="edit" data-profile-comment-id="${commentId}">Editar</button>` : ""}
                    ${canDelete ? `<button class="comment-action danger" type="button" data-profile-comment-action="delete" data-profile-comment-id="${commentId}">Excluir</button>` : ""}
                </div>
              `
            : "";

        return `
            <div class="comment-item${depth ? " comment-reply" : ""}" style="--comment-depth:${depth}" data-comment-id="${commentId}">
                <span class="comment-head">${commentAuthorHtml(comment)}</span>
                <span class="comment-body-line">
                    ${replyTarget}
                    <span class="comment-text">${escapeHtml(comment.comment_text)}</span>
                </span>
                ${actions}
            </div>
        `;
    }

    function updateProfileCommentFormUi() {
        if (!profileCommentForm) return;
        const state = profileCommentFormState || {
            mode: "new",
            commentId: 0,
            parentCommentId: 0,
            label: ""
        };
        const input = profileCommentForm.querySelector("input[name='commentText']");
        const parentInput = profileCommentForm.querySelector("input[name='parentCommentId']");
        const submit = profileCommentForm.querySelector("button[type='submit']");

        if (parentInput instanceof HTMLInputElement) {
            parentInput.value = state.mode === "reply" ? String(state.parentCommentId || 0) : "";
        }

        if (state.mode === "edit" && state.commentId > 0) {
            profileCommentForm.dataset.editCommentId = String(state.commentId);
            if (submit) submit.textContent = "Salvar";
            if (input instanceof HTMLInputElement) input.placeholder = "Edite seu comentário";
            if (profileCommentContext) {
                profileCommentContext.classList.remove("hidden");
                profileCommentContext.innerHTML = `
                    <span>Editando comentário</span>
                    <button class="comment-action" type="button" data-profile-comment-context-cancel="1">Cancelar</button>
                `;
            }
            return;
        }

        delete profileCommentForm.dataset.editCommentId;
        if (submit) submit.textContent = state.mode === "reply" ? "Responder" : "Comentar";
        if (input instanceof HTMLInputElement) {
            input.placeholder = state.mode === "reply"
                ? "Escreva sua resposta"
                : "Escreva um comentário neste perfil";
        }
        if (profileCommentContext) {
            if (state.mode === "reply" && state.parentCommentId > 0) {
                profileCommentContext.classList.remove("hidden");
                profileCommentContext.innerHTML = `
                    <span>Respondendo ${escapeHtml(state.label || "comentário")}</span>
                    <button class="comment-action" type="button" data-profile-comment-context-cancel="1">Cancelar</button>
                `;
            } else {
                profileCommentContext.classList.add("hidden");
                profileCommentContext.innerHTML = "";
            }
        }
    }

    function setProfileCommentFormState(nextState = {}) {
        profileCommentFormState = {
            mode: nextState.mode || "new",
            commentId: Number(nextState.commentId || 0),
            parentCommentId: Number(nextState.parentCommentId || 0),
            label: String(nextState.label || "")
        };
        updateProfileCommentFormUi();
    }

    function resetProfileCommentFormState() {
        setProfileCommentFormState({
            mode: "new",
            commentId: 0,
            parentCommentId: 0,
            label: ""
        });
    }

    function upsertProfileComment(comment) {
        if (!comment || !Number(comment.id)) return;
        const existingIndex = profileCommentsCache.findIndex((item) => Number(item.id) === Number(comment.id));
        if (existingIndex >= 0) profileCommentsCache[existingIndex] = comment;
        else profileCommentsCache.push(comment);
        profileCommentsCache.sort((a, b) => commentSortValue(a) - commentSortValue(b));
    }

    function removeProfileComment(commentId) {
        const numericId = Number(commentId || 0);
        if (!numericId) return;
        profileCommentsCache = profileCommentsCache.filter((item) => Number(item.id) !== numericId);
    }

    function renderProfileComments(comments) {
        if (!profileCommentsList) return;
        profileCommentsCache = Array.isArray(comments) ? comments.slice() : [];
        profileCommentsCache.sort((a, b) => commentSortValue(a) - commentSortValue(b));
        const rows = buildCommentDisplayRows(profileCommentsCache);
        if (!rows.length) {
            profileCommentsList.innerHTML = '<div class="comment-item">Sem comentários ainda.</div>';
            return;
        }
        profileCommentsList.innerHTML = rows
            .map((row) => profileCommentItemHtml(row.comment, {
                depth: row.depth,
                parentAuthor: row.parentAuthor
            }))
            .join("");
    }

    function renderProfileAchievements(achievementData) {
        if (achievementsProgress) {
            achievementsProgress.textContent = "";
            achievementsProgress.classList.add("hidden");
        }
        if (!achievementsGrid) return;
        const achievementMap = new Map(
            (achievementData?.achievements || []).map((achievement) => [achievement.key, achievement])
        );
        achievementsGrid.querySelectorAll("[data-achievement-key]").forEach((item) => {
            const key = item.getAttribute("data-achievement-key");
            const achievement = achievementMap.get(key);
            const unlocked = Boolean(achievement?.unlocked);
            setAchievementImageByUnlockState(item, String(key || ""), unlocked, achievement);
            item.classList.toggle("unlocked", unlocked);
            item.classList.toggle("locked", !unlocked);
            if (unlocked) {
                applyAchievementAccentColor(item);
            } else {
                item.style.removeProperty("--achievement-accent-color");
            }
            const nameEl = item.querySelector("strong");
            if (nameEl) {
                const unlockedName = String(achievement?.name || "").trim() || String(key || "").trim();
                nameEl.textContent = unlocked ? unlockedName : "??????";
            }
            const descriptionEl = item.querySelector(".achievement-description, .achievement-state");
            if (descriptionEl) {
                const description = String(achievement?.description || "").trim();
                descriptionEl.textContent = unlocked
                    ? (description || "Conquista desbloqueada")
                    : "???????";
            }
        });
    }

    async function refreshProfile() {
        const data = await sendJson("/api/user/profile");
        const parsedOwnUserId = Number(data.profile?.id);
        ownUserId = Number.isInteger(parsedOwnUserId) && parsedOwnUserId > 0 ? parsedOwnUserId : 0;
        if (ownUserId > 0) {
            sessionUserId = ownUserId;
        }
        const targetUserId = viewedUserId > 0 ? viewedUserId : ownUserId;
        currentProfileUserId = targetUserId || ownUserId;

        let profileView = null;
        let profileComments = { comments: [] };
        let profileAchievements = { completedRounds: 0, achievements: [] };
        if (targetUserId > 0 || viewedUserId > 0) {
            try {
                profileView = await sendJson(`/api/user/profile-view?userId=${encodeURIComponent(targetUserId || viewedUserId)}`);
                profileComments = await sendJson(`/api/user/profile-comments?userId=${encodeURIComponent(targetUserId || viewedUserId)}`);
            } catch (error) {
                try {
                    const fallbackId = targetUserId || viewedUserId;
                    profileView = await sendJson(`/api/users/${fallbackId}/profile-view`);
                    profileComments = await sendJson(`/api/users/${fallbackId}/profile-comments`);
                } catch {
                    if (viewedUserId > 0) throw error;
                    profileView = {
                        profile: data.profile,
                        activity: { given: [], received: [] },
                        canEdit: true
                    };
                };
            }
        } else {
            try {
                profileView = await sendJson("/api/user/profile-view");
                profileComments = await sendJson("/api/user/profile-comments");
                ownUserId = Number(profileView.profile?.id || ownUserId);
                currentProfileUserId = ownUserId;
            } catch {
                profileView = {
                    profile: data.profile,
                    activity: { given: [], received: [] },
                    canEdit: true
                };
            }
        }
        try {
            const achievementUserId = targetUserId || viewedUserId || ownUserId;
            profileAchievements = await sendJson(`/api/user/achievements?userId=${encodeURIComponent(achievementUserId)}`);
        } catch {
            profileAchievements = { completedRounds: 0, achievements: [] };
        }

        const canEdit = Boolean(profileView?.canEdit);
        const profile = canEdit ? data.profile : profileView.profile;
        currentNickname = profile.nickname || profile.username || "";

        Object.keys(profile).forEach((key) => {
            if (form?.elements?.[key]) {
                form.elements[key].value = profile[key] || "";
            }
        });
        if (profileNicknameDisplay) {
            profileNicknameDisplay.innerHTML = displayNameStyledHtml(profile);
        }
        if (form?.elements?.email) {
            form.elements.email.value = maskEmailForDisplay(profile.email);
        }
        if (form?.elements?.nickname) {
            form.elements.nickname.value = currentNickname;
        }
        nicknameAvailabilityState = {
            value: currentNickname,
            checked: true,
            available: true
        };
        if (emailFieldLabel) emailFieldLabel.textContent = defaultEmailLabel;

        if (avatarPreview && !pendingAvatarFile) {
            avatarPreview.src = profile.avatar_url || baseAvatar;
        }
        if (profileTitle) {
            if (canEdit) {
                profileTitle.textContent = "Seu Perfil no Clube do Jogo";
            } else {
                profileTitle.innerHTML = `Perfil de ${displayNameStyledHtml(profileView.profile)}`;
            }
        }

        form?.querySelectorAll("input,button,textarea,select").forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            if (canEdit) {
                el.removeAttribute("disabled");
            } else if (el.getAttribute("name") !== "username" && el.getAttribute("name") !== "email") {
                el.setAttribute("disabled", "disabled");
            }
        });
        if (!canEdit) {
            form?.classList.add("profile-readonly");
            profileSaveBtn?.classList.add("hidden");
            avatarSelectBtn?.setAttribute("disabled", "disabled");
            byId("sendResetFromProfile")?.closest(".card")?.classList.add("hidden");
            nicknameFieldWrap?.classList.add("hidden");
            setFeedback(nicknameCheckFeedback, "", "");
        } else {
            form?.classList.remove("profile-readonly");
            profileSaveBtn?.classList.remove("hidden");
            avatarSelectBtn?.removeAttribute("disabled");
            byId("sendResetFromProfile")?.closest(".card")?.classList.remove("hidden");
            nicknameFieldWrap?.classList.remove("hidden");
            syncNicknameCheckButtonState();
        }

        isProfileOwnerSession = Number(currentProfileUserId) > 0
            && Number(currentProfileUserId) === Number(ownUserId);

        renderProfileActivity(profileView.activity);
        renderProfileAchievements(profileAchievements);
        renderProfileComments(profileComments.comments || []);
        resetProfileCommentFormState();
        return { ...data, canEdit };
    }

    try {
        setupAchievementImageProtection();
        await refreshProfile();
    } catch (error) {
        setFeedback("feedback", error.message, "error");
    }

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        setFeedback("feedback", "", "");
        setFeedback(nicknameCheckFeedback, "", "");
        const nicknameCandidate = readNicknameInputValue() || form?.elements?.username?.value || "";
        if (!isNicknameValidatedForSave(nicknameCandidate)) {
            setFeedback(
                "feedback",
                "Verifique a disponibilidade do nickname antes de salvar",
                "error"
            );
            return;
        }
        const payload = { nickname: nicknameCandidate };
        const submitBtn = event.submitter || profileSaveBtn;
        const avatarToUpload = pendingAvatarFile;
        try {
            await withButtonLoading(submitBtn, "Salvando...", async () => {
                await sendJson("/api/user/profile", "PUT", payload);
                if (avatarToUpload) {
                    const avatarData = new FormData();
                    avatarData.append("avatar", avatarToUpload);
                    await sendForm("/api/user/avatar", avatarData);
                }
            });
            clearPendingAvatarSelection();
            setFeedback(
                "feedback",
                avatarToUpload ? "Perfil e imagem atualizados com sucesso." : "Perfil atualizado com sucesso.",
                "ok"
            );
            await refreshProfile();
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });

    form?.elements?.nickname?.addEventListener("input", () => {
        const candidate = readNicknameInputValue();
        nicknameAvailabilityState = {
            value: candidate,
            checked: isSameNicknameAsCurrent(candidate),
            available: isSameNicknameAsCurrent(candidate)
        };
        setFeedback(nicknameCheckFeedback, "", "");
        syncNicknameCheckButtonState();
    });

    checkNicknameBtn?.addEventListener("click", async () => {
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        const nicknameCandidate = readNicknameInputValue();
        if (!nicknameCandidate) {
            setFeedback(nicknameCheckFeedback, "Digite um nickname para verificar.", "error");
            syncNicknameCheckButtonState();
            return;
        }
        if (isSameNicknameAsCurrent(nicknameCandidate)) {
            setFeedback(nicknameCheckFeedback, "Esse já é o seu nickname atual.", "warn");
            syncNicknameCheckButtonState();
            return;
        }

        nicknameCheckInFlight = true;
        syncNicknameCheckButtonState();
        try {
            const result = await withButtonLoading(checkNicknameBtn, "Verificando...", async () =>
                requestNicknameAvailability(nicknameCandidate)
            );
            if (form?.elements?.nickname && result?.nickname) {
                form.elements.nickname.value = String(result.nickname);
            }
            nicknameAvailabilityState = {
                value: String(result?.nickname || nicknameCandidate),
                checked: true,
                available: Boolean(result?.available)
            };
            setFeedback(
                nicknameCheckFeedback,
                result?.message || (result?.available ? "Nickname disponível." : "Nickname indisponível."),
                result?.available ? "ok" : "error"
            );
        } catch (error) {
            setFeedback(nicknameCheckFeedback, error.message, "error");
        } finally {
            nicknameCheckInFlight = false;
            syncNicknameCheckButtonState();
        }
    });

    avatarSelectBtn?.addEventListener("click", () => {
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        if (avatarInput) avatarInput.value = "";
        avatarInput?.click();
    });

    avatarInput?.addEventListener("change", async () => {
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        const file = avatarInput.files?.[0];
        if (!file) return;
        if (!String(file.type || "").startsWith("image/")) {
            setFeedback("feedback", "Selecione apenas arquivos de imagem.", "error");
            avatarInput.value = "";
            return;
        }
        if (pendingAvatarPreviewUrl && pendingAvatarPreviewUrl.startsWith("blob:")) {
            URL.revokeObjectURL(pendingAvatarPreviewUrl);
        }
        pendingAvatarFile = file;
        pendingAvatarPreviewUrl = "";
        let immediatePreviewUrl = "";
        if (avatarPreview) {
            try {
                const previewDataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ""));
                    reader.onerror = () => reject(new Error("Falha ao carregar preview da imagem."));
                    reader.readAsDataURL(file);
                });
                pendingAvatarPreviewUrl = String(previewDataUrl || "");
            } catch {
                pendingAvatarPreviewUrl = "";
            }
            if (!pendingAvatarPreviewUrl) {
                try {
                    pendingAvatarPreviewUrl = URL.createObjectURL(file);
                } catch {
                    pendingAvatarPreviewUrl = "";
                }
            }
            immediatePreviewUrl = pendingAvatarPreviewUrl;
            avatarPreview.onerror = null;
            if (immediatePreviewUrl) avatarPreview.src = immediatePreviewUrl;
        }

        try {
            if (avatarSelectBtn) {
                avatarSelectBtn.classList.add("is-loading");
                avatarSelectBtn.setAttribute("aria-busy", "true");
                avatarSelectBtn.setAttribute("disabled", "disabled");
            }
            const avatarData = new FormData();
            avatarData.append("avatar", file);
            const uploadResult = await sendForm("/api/user/avatar", avatarData);

            pendingAvatarFile = null;
            if (avatarInput) avatarInput.value = "";
            const avatarUrl = String(uploadResult?.avatarUrl || "").trim();
            if (avatarPreview && avatarUrl) {
                const cacheBust = `v=${Date.now()}`;
                const sep = avatarUrl.includes("?") ? "&" : "?";
                const finalAvatarUrl = `${avatarUrl}${sep}${cacheBust}`;
                const switchedToFinal = await new Promise((resolve) => {
                    const probe = new Image();
                    probe.onload = () => {
                        avatarPreview.src = finalAvatarUrl;
                        resolve(true);
                    };
                    probe.onerror = () => {
                        // Mantém o preview local visível se a URL final falhar momentaneamente.
                        resolve(false);
                    };
                    probe.src = finalAvatarUrl;
                });
                if (switchedToFinal && immediatePreviewUrl) {
                    if (immediatePreviewUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(immediatePreviewUrl);
                    }
                    if (pendingAvatarPreviewUrl === immediatePreviewUrl) {
                        pendingAvatarPreviewUrl = "";
                    }
                }
            }
            setFeedback("feedback", "Imagem de perfil atualizada.", "ok");
        } catch (error) {
            setFeedback(
                "feedback",
                `${error.message} Tente novamente ou clique em Salvar perfil para reenviar.`,
                "error"
            );
        } finally {
            if (avatarSelectBtn) {
                avatarSelectBtn.classList.remove("is-loading");
                avatarSelectBtn.removeAttribute("aria-busy");
                if (!(viewedUserId > 0 && viewedUserId !== ownUserId)) {
                    avatarSelectBtn.removeAttribute("disabled");
                }
            }
        }
    });

    const sendResetBtn = byId("sendResetFromProfile");
    sendResetBtn?.addEventListener("click", async () => {
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        setFeedback("feedback", "", "");
        try {
            const result = await withButtonLoading(sendResetBtn, "Enviando link...", async () =>
                sendJson("/api/user/password-reset-link", "POST")
            );
            setFeedback("feedback", result.message, "ok");
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });

    profileCommentForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("profileCommentFeedback", "", "");
        if (!currentProfileUserId) return;

        const input = profileCommentForm.querySelector("input[name='commentText']");
        const commentText = String(input?.value || "").trim();
        if (!commentText) return;

        const parentInput = profileCommentForm.querySelector("input[name='parentCommentId']");
        const parentCommentId = Number(parentInput?.value || 0);
        const editCommentId = Number(profileCommentForm.dataset.editCommentId || 0);
        const submitBtn = event.submitter || profileCommentForm.querySelector("button[type='submit']");
        let affectedCommentId = 0;

        try {
            await withButtonLoading(submitBtn, editCommentId > 0 ? "Salvando..." : "Comentando...", async () => {
                if (editCommentId > 0) {
                    const result = await sendJson(`/api/profile-comments/${editCommentId}`, "PUT", { commentText });
                    upsertProfileComment(result.comment);
                    affectedCommentId = Number(result?.comment?.id || editCommentId);
                } else {
                    const payload = parentCommentId > 0 ? { commentText, parentCommentId } : { commentText };
                    const result = await sendJson(
                        `/api/user/profile-comments?userId=${encodeURIComponent(currentProfileUserId)}`,
                        "POST",
                        payload
                    );
                    upsertProfileComment(result.comment);
                    affectedCommentId = Number(result?.comment?.id || 0);
                }
            });

            renderProfileComments(profileCommentsCache);
            profileCommentForm.reset();
            resetProfileCommentFormState();
            setFeedback(
                "profileCommentFeedback",
                editCommentId > 0 ? "Comentário atualizado." : "Comentário publicado.",
                "ok"
            );

            if (affectedCommentId > 0 && profileCommentsList) {
                const row = profileCommentsList.querySelector(`.comment-item[data-comment-id='${affectedCommentId}']`);
                if (row instanceof HTMLElement) {
                    row.scrollIntoView({
                        behavior: "auto",
                        block: "nearest",
                        inline: "nearest"
                    });
                }
            }
        } catch (error) {
            setFeedback("profileCommentFeedback", error.message, "error");
        }
    });

    profileCommentContext?.addEventListener("click", (event) => {
        const cancelBtn = event.target.closest("button[data-profile-comment-context-cancel]");
        if (!cancelBtn) return;
        profileCommentForm?.reset();
        resetProfileCommentFormState();
    });

    profileCommentsList?.addEventListener("click", async (event) => {
        const likeToggleBtn = event.target.closest("button[data-comment-like-toggle='profile'][data-comment-id]");
        if (likeToggleBtn) {
            const commentId = Number(likeToggleBtn.dataset.commentId || 0);
            const comment = getProfileCommentById(commentId);
            if (!comment) return;
            try {
                const result = await sendJson(`/api/profile-comments/${commentId}/like`, "POST", {});
                upsertProfileComment(result.comment || {
                    ...comment,
                    likes_count: Number(result?.likesCount || 0),
                    liked_by_me: result?.liked ? 1 : 0
                });
                renderProfileComments(profileCommentsCache);
            } catch (error) {
                setFeedback("profileCommentFeedback", error.message, "error");
            }
            return;
        }

        const likeListBtn = event.target.closest("button[data-comment-like-list='profile'][data-comment-id]");
        if (likeListBtn) {
            await showCommentLikesPopup("profile", Number(likeListBtn.dataset.commentId || 0), likeListBtn);
            return;
        }

        const actionBtn = event.target.closest("button[data-profile-comment-action][data-profile-comment-id]");
        if (!actionBtn) return;

        const action = String(actionBtn.dataset.profileCommentAction || "").trim().toLowerCase();
        const commentId = Number(actionBtn.dataset.profileCommentId || 0);
        const comment = getProfileCommentById(commentId);
        if (!comment) return;

        const input = profileCommentForm?.querySelector("input[name='commentText']");

        if (action === "reply") {
            setProfileCommentFormState({
                mode: "reply",
                commentId: 0,
                parentCommentId: commentId,
                label: `a ${displayName(comment)}`
            });
            if (input instanceof HTMLInputElement) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
            return;
        }

        if (action === "edit") {
            if (!canEditProfileComment(comment)) return;
            setProfileCommentFormState({
                mode: "edit",
                commentId,
                parentCommentId: 0,
                label: ""
            });
            if (input instanceof HTMLInputElement) {
                input.value = String(comment.comment_text || "");
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
            return;
        }

        if (action === "delete") {
            if (!canDeleteProfileComment(comment)) return;
            const confirmed = window.confirm("Excluir este comentário?");
            if (!confirmed) return;
            try {
                await withButtonLoading(actionBtn, "Excluindo...", () =>
                    sendJson(`/api/profile-comments/${commentId}`, "DELETE")
                );
                removeProfileComment(commentId);
                renderProfileComments(profileCommentsCache);
                if (
                    Number(profileCommentFormState?.commentId || 0) === commentId
                    || Number(profileCommentFormState?.parentCommentId || 0) === commentId
                ) {
                    profileCommentForm?.reset();
                    resetProfileCommentFormState();
                }
                setFeedback("profileCommentFeedback", "Comentário excluído.", "ok");
            } catch (error) {
                setFeedback("profileCommentFeedback", error.message, "error");
            }
        }
    });

    profileActivitySection?.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-profile-page-mode][data-profile-page-action]");
        if (!btn) return;
        const mode = btn.dataset.profilePageMode;
        const action = btn.dataset.profilePageAction;
        if (mode !== "given" && mode !== "received") return;
        const items = profileActivityCache[mode] || [];
        const totalPages = Math.max(1, Math.ceil(items.length / profilePageSize));
        const current = profileActivityPage[mode] || 1;
        if (action === "next") profileActivityPage[mode] = Math.min(totalPages, current + 1);
        if (action === "prev") profileActivityPage[mode] = Math.max(1, current - 1);
        renderProfileListWithPagination(
            mode === "given" ? profileGivenList : profileReceivedList,
            items,
            mode
        );
    });

}

let homeActiveRound = null;
let homeRoundsMap = new Map();
let homeRoundFeedPageMap = new Map();
let homeCommentFormAlignRaf = 0;
const HOME_FEED_RECOMMENDATION_PAGE_SIZE = 6;

function alignRoundCommentForms(roundSection) {
    if (!(roundSection instanceof HTMLElement)) return;
    const cards = [...roundSection.querySelectorAll(".carousel-track > article.recommendation-card[data-recommendation-id]")];
    const forms = [...roundSection.querySelectorAll("form.comment-form[data-comment-form]")];

    forms.forEach((form) => form.style.removeProperty("margin-top"));
    cards.forEach((card) => {
        card.style.removeProperty("min-height");
        card.style.removeProperty("height");
        card.style.removeProperty("max-height");
    });

    if (window.matchMedia("(max-width: 600px)").matches) {
        if (!cards.length) return;
        const tallest = Math.max(...cards.map((card) => card.getBoundingClientRect().height));
        const normalizedTallest = Math.max(0, Math.ceil(tallest));
        if (!normalizedTallest) return;
        cards.forEach((card) => {
            card.style.height = `${normalizedTallest}px`;
            card.style.maxHeight = `${normalizedTallest}px`;
        });
        return;
    }

    if (!forms.length || !window.matchMedia("(min-width: 1051px)").matches) return;
    forms.forEach((form) => {
        form.style.marginTop = "0px";
    });

    const tops = forms.map((form) => form.getBoundingClientRect().top);
    const lowestTop = Math.max(...tops);
    forms.forEach((form, index) => {
        const offset = Math.max(0, Math.round(lowestTop - tops[index]));
        form.style.marginTop = `${offset}px`;
    });
}

function alignHomeCommentFormsByRound() {
    const root = byId("roundCarousels");
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll(".round-carousel").forEach((section) => {
        alignRoundCommentForms(section);
    });
}

function scheduleHomeCommentFormAlignment() {
    if (page !== "home") return;
    if (homeCommentFormAlignRaf) cancelAnimationFrame(homeCommentFormAlignRaf);
    homeCommentFormAlignRaf = requestAnimationFrame(() => {
        homeCommentFormAlignRaf = 0;
        alignHomeCommentFormsByRound();
    });
}

function renderNavalChartForHome(round) {
    const chart = byId("homeNavalChart");
    if (!chart) return;
    const rated = (round.recommendations || []).filter((rec) => rec.rating_letter && rec.interest_score);
    if (!rated.length) {
        chart.innerHTML = "<p style='padding:12px;color:#9fb3e0;'>Rodada sem notas ainda.</p>";
        return;
    }

    const grouped = new Map();
    for (const rec of rated) {
        const x = Math.max(1, Math.min(10, Number(rec.interest_score)));
        const y = letterToY(rec.rating_letter);
        const key = `${x}|${y}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(rec);
    }

    chart.innerHTML = [...grouped.entries()]
        .map(([key, list]) => {
            list.sort((a, b) => (b.rating_updated_at || b.updated_at || 0) - (a.rating_updated_at || a.updated_at || 0));
            const top = list[0];
            const [xRaw, yRaw] = key.split("|");
            const x = Number(xRaw);
            const y = Number(yRaw);
            const left = ((x - 0.5) / 10) * 100;
            const topPos = ((10.5 - y) / 10) * 100;
            const pointGrade = navalGradeLabel(top);
            const stack = list
                .map(
                    (rec) => {
                        const grade = navalGradeLabel(rec);
                        return `
                            <div class="naval-stack-item">
                                <div class="naval-stack-thumb">
                                    <img src="${escapeHtml(rec.game_cover_url || baseAvatar)}" alt="${escapeHtml(rec.game_name)}">
                                    <span class="naval-grade-badge naval-grade-badge-stack">${escapeHtml(grade)}</span>
                                </div>
                                <div>${escapeHtml(rec.game_name)}</div>
                            </div>
                        `;
                    }
                )
                .join("");
            return `
                <div class="naval-point" data-naval-key="${escapeHtml(key)}" style="left:${left}%;top:${topPos}%;">
                    <img src="${escapeHtml(top.game_cover_url || baseAvatar)}" alt="${escapeHtml(top.game_name)}">
                    <span class="naval-grade-badge">${escapeHtml(pointGrade)}</span>
                    ${list.length > 1 ? `<span class="naval-count">${list.length}</span>` : ""}
                    <div class="naval-stack">
                        <div class="naval-stack-items">${stack}</div>
                    </div>
                </div>
            `;
        })
        .join("");
    adjustNavalStacks(chart);
    setupMobileNavalPointBehavior(chart);
    restoreOpenNavalStack(chart);
}

function renderFeed(rounds) {
    const container = byId("roundCarousels");
    if (!container) return;
    homeRoundsMap = new Map((rounds || []).map((round) => [Number(round.id), round]));
    recommendationCommentSignatureCaches.home.clear();
    recommendationCommentIdsCaches.home.clear();

    if (!rounds.length) {
        container.innerHTML = '<p>Nenhuma indicação publicada ainda.</p>';
        clearStaleCommentSignatures("home", []);
        return;
    }

    container.innerHTML = rounds
        .map(
            (round) => {
                const recommendations = round.recommendations || [];
                const totalPages = Math.max(
                    1,
                    Math.ceil(recommendations.length / HOME_FEED_RECOMMENDATION_PAGE_SIZE)
                );
                const currentPage = Math.min(
                    totalPages,
                    Math.max(1, homeRoundFeedPageMap.get(round.id) || 1)
                );
                homeRoundFeedPageMap.set(round.id, currentPage);
                const start = (currentPage - 1) * HOME_FEED_RECOMMENDATION_PAGE_SIZE;
                const pageRecommendations = recommendations.slice(
                    start,
                    start + HOME_FEED_RECOMMENDATION_PAGE_SIZE
                );
                const participants = Array.isArray(round.participants) ? round.participants : [];
                const isRoundParticipant = participants.some((item) => Number(item?.id || 0) === Number(sessionUserId || 0));
                const canReopenRound = Boolean(sessionIsOwner || sessionIsModerator);
                const canEditReopenedRound = Boolean(
                    round.status === "reopened"
                    && (isRoundParticipant || sessionIsOwner || sessionIsModerator)
                );
                const showRoundActions = round.status === "closed" || round.status === "reopened";
                const pagination = recommendations.length > HOME_FEED_RECOMMENDATION_PAGE_SIZE
                    ? `
                        <div class="pagination-controls">
                            <button class="btn btn-outline" type="button" data-feed-page-action="prev" data-feed-round-id="${round.id}" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
                            <span>Página ${currentPage} de ${totalPages}</span>
                            <button class="btn btn-outline" type="button" data-feed-page-action="next" data-feed-round-id="${round.id}" ${currentPage >= totalPages ? "disabled" : ""}>Próxima</button>
                        </div>
                      `
                    : "";
                return `
                <section class="round-carousel" data-round-id="${round.id}">
                    <div class="row-between">
                        <h3>Rodada - ${escapeHtml(formatRoundDateTime(round.created_at))} - ${escapeHtml(homeRoundPhaseLabel(round))}</h3>
                        ${showRoundActions
        ? `
                                <div class="inline-actions home-round-actions">
                                    ${round.status === "closed" && canReopenRound ? `<button class="btn btn-warn" data-home-reopen-round="${round.id}" type="button">Reabrir Rodada</button>` : ""}
                                    ${canEditReopenedRound ? `<button class="btn btn-success" data-home-edit-round="${round.id}" type="button">Editar Rodada</button>` : ""}
                                    <button class="btn btn-outline" data-open-naval-plan="${round.id}" type="button">Plano Naval</button>
                                </div>
                            `
        : ""}
                    </div>
                    <p>Criador: ${userLinkHtml({ nickname: round.creator_nickname, username: round.creator_username }, round.creator_user_id)}</p>
                    <p class="round-participants-mini">Participantes: ${(round.participants || []).map((item) => userLinkHtml(item, item.id)).join(" | ") || "sem participantes"}</p>
                    <div class="carousel-track">
                        ${pageRecommendations
        .map((rec) =>
            recommendationCardTemplate(rec, {
                showGradeOverlay: true,
                showInlineGrade: true,
                layout: "round-indication"
            })
        )
        .join("")}
                    </div>
                    ${pagination}
                </section>
            `;
            }
        )
        .join("");

    const visibleRecommendationIds = [];
    container.querySelectorAll("article[data-recommendation-id]").forEach((card) => {
        const recommendationId = Number(card.dataset.recommendationId || 0);
        if (!recommendationId) return;
        visibleRecommendationIds.push(recommendationId);
        const recommendation = findHomeRecommendationById(recommendationId);
        syncRecommendationCommentList(recommendation, "home", true);
        resetCommentFormState(recommendationId);
    });
    clearStaleCommentSignatures("home", visibleRecommendationIds);
    scheduleHomeCommentFormAlignment();
}

function updateHomeRoundStatus(activeRound) {
    const textEl = byId("activeRoundText");
    const newBtn = byId("newRoundBtn");
    const canStartRound = Boolean(sessionIsOwner || sessionIsModerator);

    if (!activeRound) {
        if (textEl) {
            textEl.textContent = canStartRound
                ? "Nenhuma rodada ativa. Crie uma nova rodada para começar."
                : "Nenhuma rodada ativa no momento.";
        }
        if (newBtn) {
            newBtn.disabled = !canStartRound;
            newBtn.textContent = canStartRound ? "Nova Rodada" : "Aguarde por nova rodada";
            newBtn.classList.remove("btn-success");
            newBtn.classList.toggle("btn-disabled", !canStartRound);
        }
        return;
    }

    const creatorUser = {
        id: activeRound.creator_user_id,
        nickname: activeRound.creator_nickname,
        username: activeRound.creator_username
    };
    const creatorNameStyled = displayNameStyledHtml(creatorUser);
    const activePhase = String(activeRound.phase || activeRound.status || "");

    if (activePhase === "draft") {
        if (activeRound.isCreator) {
            textEl.textContent = `Sua rodada de ${formatRoundDateTime(activeRound.created_at)} está em preparação.`;
            newBtn.disabled = false;
            newBtn.textContent = "Gerenciar Rodada";
            newBtn.classList.add("btn-success");
            newBtn.classList.remove("btn-disabled");
        } else {
            textEl.innerHTML = `Espectar Nova Rodada (${creatorNameStyled})`;
            newBtn.disabled = false;
            newBtn.textContent = "Ver Rodada em Andamento";
            newBtn.classList.add("btn-success");
            newBtn.classList.remove("btn-disabled");
        }
    } else if (activePhase === "reveal") {
        textEl.innerHTML = `Espectar Nova Rodada (${creatorNameStyled}) - fase de revelação.`;
        newBtn.disabled = false;
        newBtn.textContent = activeRound.isCreator ? "Gerenciar Rodada" : "Ver Rodada em Andamento";
        newBtn.classList.add("btn-success");
        newBtn.classList.remove("btn-disabled");
    } else if (activePhase === "rating") {
        textEl.textContent = `Rodada de ${formatRoundDateTime(activeRound.created_at)} em fase de avaliação.`;
        newBtn.disabled = false;
        newBtn.textContent = activeRound.isCreator ? "Gerenciar Rodada" : "Ver Rodada em Andamento";
        newBtn.classList.add("btn-success");
        newBtn.classList.remove("btn-disabled");
    } else {
        textEl.textContent = `Rodada de ${formatRoundDateTime(activeRound.created_at)} em Fase de indicação.`;
        newBtn.disabled = false;
        newBtn.textContent = activeRound.isCreator ? "Gerenciar Rodada" : "Ver Rodada em Andamento";
        newBtn.classList.add("btn-success");
        newBtn.classList.remove("btn-disabled");
    }
}

function scheduleHomePhaseRefresh(activeRound) {
    if (homePhaseRefreshTimer) {
        clearTimeout(homePhaseRefreshTimer);
        homePhaseRefreshTimer = 0;
    }
    const ts = Number(activeRound?.rating_starts_at || 0);
    const status = String(activeRound?.status || "");
    if (!ts || status !== "indication") return;
    const now = Math.floor(Date.now() / 1000);
    const delayMs = Math.max(0, (ts - now) * 1000 + 120);
    homePhaseRefreshTimer = window.setTimeout(() => {
        Promise.all([refreshHomeActive(), refreshHomeFeed()]).catch(() => {
            // sem acao
        });
    }, delayMs);
}

async function refreshHomeActive() {
    const active = await sendJson("/api/rounds/active");
    homeActiveRound = active.activeRound;
    updateHomeRoundStatus(homeActiveRound);
    scheduleHomePhaseRefresh(homeActiveRound);
}

async function refreshHomeFeed() {
    const feed = await sendJson("/api/feed/rounds?limit=8");
    renderFeed(feed.rounds || []);
}
async function handleHome() {
    await ensureSessionUserId();
    try {
        await Promise.all([refreshHomeActive(), refreshHomeFeed()]);
    } catch (error) {
        setFeedback("homeFeedback", error.message, "error");
    }

    const suggestionModal = byId("suggestionModal");
    const openSuggestionModalBtn = byId("openSuggestionModalBtn");
    const cancelSuggestionBtn = byId("cancelSuggestionBtn");
    const suggestionForm = byId("suggestionForm");
    const suggestionTargetPage = byId("suggestionTargetPage");
    const suggestionText = byId("suggestionText");
    const sendSuggestionBtn = byId("sendSuggestionBtn");

    const closeSuggestionModal = () => {
        if (!suggestionModal) return;
        suggestionModal.classList.add("hidden");
        suggestionModal.setAttribute("aria-hidden", "true");
        setFeedback("suggestionFormFeedback", "", "");
        if (suggestionForm instanceof HTMLFormElement) {
            suggestionForm.reset();
        }
    };

    const openSuggestionModal = () => {
        if (!suggestionModal || !(suggestionTargetPage instanceof HTMLSelectElement)) return;
        const options = suggestionTargetsForCurrentUser();
        suggestionTargetPage.innerHTML = options
            .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
            .join("");
        suggestionModal.classList.remove("hidden");
        suggestionModal.setAttribute("aria-hidden", "false");
        setFeedback("suggestionFormFeedback", "", "");
        if (suggestionText instanceof HTMLTextAreaElement) {
            suggestionText.focus();
            suggestionText.setSelectionRange(suggestionText.value.length, suggestionText.value.length);
        }
    };

    openSuggestionModalBtn?.addEventListener("click", openSuggestionModal);
    cancelSuggestionBtn?.addEventListener("click", closeSuggestionModal);
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && suggestionModal && !suggestionModal.classList.contains("hidden")) {
            closeSuggestionModal();
        }
    });
    suggestionForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!(suggestionTargetPage instanceof HTMLSelectElement) || !(suggestionText instanceof HTMLTextAreaElement)) return;
        const targetPage = String(suggestionTargetPage.value || "").trim().toLowerCase();
        const suggestionContent = String(suggestionText.value || "").trim();
        if (!targetPage) {
            setFeedback("suggestionFormFeedback", "Selecione a tela da sugestão.", "error");
            return;
        }
        if (suggestionContent.length < 5) {
            setFeedback("suggestionFormFeedback", "Digite ao menos 5 caracteres.", "error");
            return;
        }
        try {
            const result = await withButtonLoading(sendSuggestionBtn, "Enviando...", () =>
                sendJson("/api/suggestions", "POST", {
                    targetPage,
                    suggestionText: suggestionContent
                })
            );
            closeSuggestionModal();
            setFeedback("homeFeedback", result?.message || "Sugestão enviada com sucesso.", "ok");
        } catch (error) {
            setFeedback("suggestionFormFeedback", error.message, "error");
        }
    });

    byId("refreshFeedBtn")?.addEventListener("click", async () => {
        try {
            await refreshHomeFeed();
            setFeedback("homeFeedback", "Feed atualizado.", "ok");
        } catch (error) {
            setFeedback("homeFeedback", error.message, "error");
        }
    });

    byId("newRoundBtn")?.addEventListener("click", async () => {
        if (!sessionIsOwner && !sessionIsModerator && !homeActiveRound) return;
        try {
            if (homeActiveRound) {
                window.location.href = `/round.html?roundId=${homeActiveRound.id}`;
                return;
            }
            const created = await sendJson("/api/rounds/new", "POST", {});
            homeActiveRound = created.round;
            updateHomeRoundStatus(homeActiveRound);
            setFeedback("homeFeedback", "Nova rodada criada. Você já pode abrir e gerenciar.", "ok");
        } catch (error) {
            setFeedback("homeFeedback", error.message, "error");
            if (String(error.message || "").includes("rodada ativa")) {
                try {
                    await refreshHomeActive();
                    if (homeActiveRound) {
                        window.location.href = `/round.html?roundId=${homeActiveRound.id}`;
                    }
                } catch {
                    // no-op
                }
            }
        }
    });

    byId("roundCarousels")?.addEventListener("click", async (event) => {
        const handledCommentAction = await handleRecommendationCommentAction(event, "home", "homeFeedback");
        if (handledCommentAction) return;

        const pageBtn = event.target.closest("button[data-feed-page-action][data-feed-round-id]");
        if (pageBtn) {
            const roundId = Number(pageBtn.dataset.feedRoundId);
            const action = pageBtn.dataset.feedPageAction;
            const round = homeRoundsMap.get(roundId);
            if (!round) return;
            const totalPages = Math.max(
                1,
                Math.ceil((round.recommendations || []).length / HOME_FEED_RECOMMENDATION_PAGE_SIZE)
            );
            const current = homeRoundFeedPageMap.get(roundId) || 1;
            if (action === "next") homeRoundFeedPageMap.set(roundId, Math.min(totalPages, current + 1));
            if (action === "prev") homeRoundFeedPageMap.set(roundId, Math.max(1, current - 1));
            renderFeed(Array.from(homeRoundsMap.values()));
            return;
        }

        const reopenBtn = event.target.closest("button[data-home-reopen-round]");
        if (reopenBtn) {
            const roundId = Number(reopenBtn.dataset.homeReopenRound);
            if (!roundId) return;
            try {
                await withButtonLoading(reopenBtn, "Reabrindo...", async () => {
                    const result = await sendJson(`/api/rounds/${roundId}/close`, "POST", {});
                    setFeedback("homeFeedback", result.message || "Rodada reaberta.", "ok");
                    await Promise.all([refreshHomeActive(), refreshHomeFeed()]);
                });
            } catch (error) {
                setFeedback("homeFeedback", error.message, "error");
            }
            return;
        }

        const editRoundBtn = event.target.closest("button[data-home-edit-round]");
        if (editRoundBtn) {
            const roundId = Number(editRoundBtn.dataset.homeEditRound);
            if (!roundId) return;
            window.location.href = `/round.html?roundId=${roundId}`;
            return;
        }

        const btn = event.target.closest("button[data-open-naval-plan]");
        if (!btn) return;
        const roundId = Number(btn.dataset.openNavalPlan);
        const round = homeRoundsMap.get(roundId);
        if (!round) return;
        const modal = byId("navalModal");
        byId("navalModalTitle").textContent = `Plano Naval - Rodada ${formatRoundDateTime(round.created_at)}`;
        modal?.classList.remove("hidden");
        renderNavalChartForHome(round);
        requestAnimationFrame(() => {
            const chart = byId("homeNavalChart");
            adjustNavalStacks(chart);
        });
    });

    byId("closeNavalModalBtn")?.addEventListener("click", () => {
        byId("navalModal")?.classList.add("hidden");
    });

    byId("navalModal")?.addEventListener("click", (event) => {
        if (event.target.id === "navalModal") {
            byId("navalModal")?.classList.add("hidden");
        }
    });

    byId("roundCarousels")?.addEventListener("submit", async (event) => {
        const form = event.target;
        event.preventDefault();
        await submitRecommendationCommentForm(form, "home", "homeFeedback");
    });

    window.addEventListener("resize", scheduleHomeCommentFormAlignment);
}

let currentRound = null;
let roundUsers = [];
let roundRecommendationsStructureSignature = "";
let pairExclusionAutosaveToken = 0;
let pairExclusionsRenderSignature = "";

function renderParticipantList(round) {
    const list = byId("participantList");
    if (!list) return;
    const canManage = canManageDraftRound(round);

    list.innerHTML = (round.participants || [])
        .map((user) => {
            const removeButton =
                canManage && user.id !== round.creator_user_id
                    ? `<button class="btn btn-outline" data-remove-user="${user.id}" type="button">Remover</button>`
                    : "";
            return `
                <div class="search-item">
                    <div class="search-item-main">
                        <img class="avatar-mini" src="${escapeHtml(user.avatar_url || baseAvatar)}" alt="avatar">
                        <div>
                            <strong>${displayNameStyledHtml(user)}</strong>
                            <div>@${escapeHtml(user.username)}</div>
                        </div>
                    </div>
                    ${removeButton}
                </div>
            `;
        })
        .join("");
}

function pairExclusionKey(giverUserId, receiverUserId) {
    return `${Number(giverUserId)}:${Number(receiverUserId)}`;
}

function clearPairExclusionInlineErrors() {
    const list = byId("pairExclusionsList");
    if (!list) return;
    list.querySelectorAll("[data-pair-error-for]").forEach((el) => {
        el.textContent = "";
        el.classList.remove("active");
    });
}

function showPairExclusionInlineError(giverUserId, message) {
    const list = byId("pairExclusionsList");
    if (!list) return;
    const target = list.querySelector(`[data-pair-error-for="${Number(giverUserId)}"]`);
    if (!target) return;
    target.textContent = normalizeTextArtifacts(message);
    target.classList.add("active");
}

function validatePairExclusionsConfig(participants, pairs, options = {}) {
    const participantList = Array.isArray(participants) ? participants : [];
    const participantIds = participantList
        .map((item) => Number(item.id))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (participantIds.length < 2) {
        return { ok: true, message: "", invalidGiverId: 0 };
    }

    const namesById = new Map(participantList.map((item) => [Number(item.id), displayName(item)]));
    const blocked = new Set();
    (Array.isArray(pairs) ? pairs : []).forEach((item) => {
        const giverUserId = Number(item?.giverUserId ?? item?.giver_user_id ?? 0);
        const receiverUserId = Number(item?.receiverUserId ?? item?.receiver_user_id ?? 0);
        if (!Number.isInteger(giverUserId) || !Number.isInteger(receiverUserId)) return;
        if (giverUserId <= 0 || receiverUserId <= 0 || giverUserId === receiverUserId) return;
        blocked.add(pairExclusionKey(giverUserId, receiverUserId));
    });

    const allowedMap = new Map();
    for (const giverId of participantIds) {
        const allowed = participantIds.filter(
            (receiverId) => receiverId !== giverId && !blocked.has(pairExclusionKey(giverId, receiverId))
        );
        if (!allowed.length) {
            const giverName = namesById.get(giverId) || "Participante";
            return {
                ok: false,
                message: `${giverName} precisa ter pelo menos 1 pessoa disponível para sortear.`,
                invalidGiverId: giverId
            };
        }
        allowedMap.set(giverId, allowed);
    }

    const givers = [...participantIds].sort(
        (a, b) => (allowedMap.get(a) || []).length - (allowedMap.get(b) || []).length
    );
    const usedReceivers = new Set();
    const backtrack = (index) => {
        if (index >= givers.length) return true;
        const giverId = givers[index];
        const optionsList = (allowedMap.get(giverId) || []).filter((id) => !usedReceivers.has(id));
        for (const receiverId of optionsList) {
            usedReceivers.add(receiverId);
            if (backtrack(index + 1)) return true;
            usedReceivers.delete(receiverId);
        }
        return false;
    };

    if (!backtrack(0)) {
        const fallbackGiverId = Number(options.changedGiverUserId || 0);
        return {
            ok: false,
            message: "Restrições inconsistentes: ajuste os bloqueios para permitir um sorteio válido para todos.",
            invalidGiverId: Number.isInteger(fallbackGiverId) && fallbackGiverId > 0 ? fallbackGiverId : 0
        };
    }

    return { ok: true, message: "", invalidGiverId: 0 };
}

function renderPairExclusionsEditor(round) {
    const section = byId("pairExclusionsSection");
    const list = byId("pairExclusionsList");
    if (!section || !list) return;
    const canManage = canManageDraftRound(round);

    if (round.phase !== "draft") {
        pairExclusionsRenderSignature = "";
        section.classList.add("hidden");
        list.innerHTML = "";
        return;
    }

    section.classList.remove("hidden");

    const participants = round.participants || [];
    const participantSignature = participants
        .map((item) => `${Number(item?.id) || 0}:${String(item?.username || "")}:${String(item?.nickname || "")}`)
        .join("|");
    const exclusionsSignature = (round.pair_exclusions || [])
        .map((item) => pairExclusionKey(item.giver_user_id, item.receiver_user_id))
        .sort()
        .join("|");
    const renderSignature = `draft|manage:${canManage ? 1 : 0}|participants:${participantSignature}|exclusions:${exclusionsSignature}`;
    if (renderSignature === pairExclusionsRenderSignature) {
        return;
    }
    pairExclusionsRenderSignature = renderSignature;

    if (participants.length < 2) {
        list.innerHTML = "<p>Adicione ao menos 2 participantes para configurar restrições.</p>";
        return;
    }

    const exclusions = new Set(
        (round.pair_exclusions || []).map((item) => pairExclusionKey(item.giver_user_id, item.receiver_user_id))
    );

    list.innerHTML = participants
        .map((giver) => {
            const receivers = participants.filter((receiver) => receiver.id !== giver.id);
            const options = receivers
                .map((receiver) => {
                    const key = pairExclusionKey(giver.id, receiver.id);
                    const checked = exclusions.has(key) ? "checked" : "";
                    return `
                        <label class="pair-exclusion-item">
                            <input type="checkbox" data-pair-giver="${giver.id}" data-pair-receiver="${receiver.id}" ${checked} ${canManage ? "" : "disabled"}>
                            <span>${displayNameStyledHtml(receiver)}</span>
                        </label>
                    `;
                })
                .join("");

            return `
                <div class="pair-exclusion-row" data-pair-giver-row="${giver.id}">
                    <div class="pair-exclusion-row-feedback" data-pair-error-for="${giver.id}"></div>
                    <div class="pair-exclusion-giver">${displayNameStyledHtml(giver)}</div>
                    <div class="pair-exclusion-options" role="group" aria-label="Restrições de ${escapeHtml(displayName(giver))}">
                        ${options}
                    </div>
                </div>
            `;
        })
        .join("");
}

function collectPairExclusionsFromScreen() {
    const list = byId("pairExclusionsList");
    if (!list) return [];
    return [...list.querySelectorAll("input[type='checkbox'][data-pair-giver][data-pair-receiver]:checked")]
        .map((input) => ({
            giverUserId: Number(input.getAttribute("data-pair-giver") || 0),
            receiverUserId: Number(input.getAttribute("data-pair-receiver") || 0)
        }))
        .filter((item) => Number.isInteger(item.giverUserId) && item.giverUserId > 0 && Number.isInteger(item.receiverUserId) && item.receiverUserId > 0 && item.giverUserId !== item.receiverUserId);
}

function validatePairExclusionsFromScreen(options = {}) {
    const participants = currentRound?.participants || [];
    const pairs = collectPairExclusionsFromScreen();
    const showFeedback = options.showFeedback !== false;
    const validation = validatePairExclusionsConfig(participants, pairs, {
        changedGiverUserId: Number(options.changedGiverUserId || 0)
    });

    if (!showFeedback) return validation;

    clearPairExclusionInlineErrors();
    if (!validation.ok) {
        if (validation.invalidGiverId > 0) {
            showPairExclusionInlineError(validation.invalidGiverId, validation.message);
            setFeedback("roundFeedback", "", "");
        } else {
            setFeedback("roundFeedback", validation.message, "error");
        }
        return validation;
    }

    setFeedback("roundFeedback", "", "");
    return validation;
}

async function persistPairExclusionsForCurrentRound() {
    if (!canManageDraftRound(currentRound)) return;
    const pairs = collectPairExclusionsFromScreen();
    const validation = validatePairExclusionsConfig(currentRound.participants || [], pairs);
    if (!validation.ok) {
        throw new Error(validation.message);
    }
    const result = await sendJson(`/api/rounds/${currentRound.id}/pair-exclusions`, "PUT", { pairs });
    currentRound = result.round;
    renderRoundState(currentRound);
}

async function autosavePairExclusionsForCurrentRound() {
    if (!canManageDraftRound(currentRound)) return;
    const token = ++pairExclusionAutosaveToken;
    setFeedback("roundFeedback", "Salvando restrições...", "");
    try {
        await persistPairExclusionsForCurrentRound();
        if (token !== pairExclusionAutosaveToken) return;
        setFeedback("roundFeedback", "Restrições atualizadas.", "ok");
    } catch (error) {
        if (token !== pairExclusionAutosaveToken) return;
        setFeedback("roundFeedback", error.message, "error");
    }
}

function renderRoundRecommendations(round) {
    const container = byId("roundRecommendations");
    if (!container) return;
    const recommendations = round.recommendations || [];
    const renderMode = round.phase === "indication" ? "round-indication" : "default";
    const structureSignature = recommendations
        .map((rec) => `${renderMode}:${rec.id}:${rec.updated_at || 0}:${rec.rating_updated_at || 0}`)
        .join("|");

    if (!recommendations.length) {
        container.innerHTML = "<p>Ainda não há indicações enviadas nesta rodada.</p>";
        recommendationCommentSignatureCaches.round.clear();
        recommendationCommentIdsCaches.round.clear();
        clearStaleCommentSignatures("round", []);
        roundRecommendationsStructureSignature = structureSignature;
        return;
    }

    if (structureSignature !== roundRecommendationsStructureSignature) {
        container.innerHTML = recommendations
            .map((rec) =>
                recommendationCardTemplate(rec, {
                    showGradeOverlay: false,
                    layout: renderMode
                })
            )
            .join("");
        recommendationCommentSignatureCaches.round.clear();
        recommendationCommentIdsCaches.round.clear();
        recommendations.forEach((rec) => resetCommentFormState(rec.id));
        roundRecommendationsStructureSignature = structureSignature;
    }

    recommendations.forEach((rec) => syncRecommendationCommentList(rec, "round"));
    clearStaleCommentSignatures("round", recommendations.map((rec) => rec.id));
}

function resetRoundSections() {
    byId("draftCreatorSection")?.classList.add("hidden");
    byId("draftSpectatorSection")?.classList.add("hidden");
    byId("revealSection")?.classList.add("hidden");
    byId("indicationSection")?.classList.add("hidden");
}

function canManageDraftRound(roundLike = currentRound) {
    const round = roundLike || null;
    if (!round || String(round.phase || "") !== "draft") return false;
    return Boolean(round.isCreator || sessionIsOwner || sessionIsModerator);
}

function applyDraftReadOnlyUi(round) {
    const draftSection = byId("draftCreatorSection");
    const draftReadonlyHint = byId("draftReadonlyHint");
    const canManage = canManageDraftRound(round);
    if (!draftSection) return;

    draftSection.classList.toggle("draft-readonly-locked", !canManage);
    if (draftReadonlyHint) {
        draftReadonlyHint.classList.toggle("hidden", canManage);
    }

    const searchInput = byId("participantSearch");
    if (searchInput instanceof HTMLInputElement) {
        searchInput.disabled = !canManage;
    }
    const searchTools = draftSection.querySelector(".participant-tools");
    if (searchTools instanceof HTMLElement) {
        searchTools.classList.toggle("hidden", !canManage);
    }
    const searchResults = byId("participantSearchResults");
    if (searchResults instanceof HTMLElement) {
        searchResults.classList.toggle("hidden", !canManage);
        if (!canManage) {
            searchResults.innerHTML = "";
        }
    }

    const searchBtn = byId("searchParticipantsBtn");
    if (searchBtn instanceof HTMLButtonElement) {
        searchBtn.disabled = !canManage;
    }

    const drawBtn = byId("drawBtn");
    if (drawBtn instanceof HTMLButtonElement) {
        const canUseDraw = canManage;
        drawBtn.classList.toggle("hidden", !canUseDraw);
        drawBtn.disabled = !canUseDraw;
    }

    const interactiveElements = draftSection.querySelectorAll(
        "#participantSearchResults button, #participantList button, #pairExclusionsList input[type='checkbox']"
    );
    interactiveElements.forEach((element) => {
        if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
            element.disabled = !canManage;
        }
    });
}

let currentRoundTab = "indications";

function setRoundTab(tab) {
    currentRoundTab = tab === "ratings" ? "ratings" : "indications";
    const indicationsBtn = byId("tabIndicationsBtn");
    const ratingsBtn = byId("tabRatingsBtn");
    const indicationsPanel = byId("tabIndicationsPanel");
    const ratingsPanel = byId("tabRatingsPanel");

    if (!indicationsBtn || !ratingsBtn || !indicationsPanel || !ratingsPanel) return;

    if (currentRoundTab === "indications") {
        indicationsBtn.classList.add("active");
        ratingsBtn.classList.remove("active");
        indicationsPanel.classList.remove("hidden");
        ratingsPanel.classList.add("hidden");
    } else {
        indicationsBtn.classList.remove("active");
        ratingsBtn.classList.add("active");
        indicationsPanel.classList.add("hidden");
        ratingsPanel.classList.remove("hidden");
    }
}

function adjustNavalStacks(chart) {
    if (!chart) return;
    const chartRect = chart.getBoundingClientRect();
    chart.querySelectorAll(".naval-point").forEach((point) => {
        point.classList.remove("flip-stack");
        const stack = point.querySelector(".naval-stack");
        if (!stack) return;
        const itemCount = stack.querySelectorAll(".naval-stack-item").length || 1;
        const stackWidth = Math.max(itemCount * 102 + 24, 130);
        const pointRect = point.getBoundingClientRect();
        const stackOffset = 72;
        const availableRight = chartRect.right - pointRect.right - stackOffset;
        const availableLeft = pointRect.left - chartRect.left - stackOffset;
        const fitsRight = availableRight >= stackWidth;
        const fitsLeft = availableLeft >= stackWidth;

        if (!fitsRight && fitsLeft) {
            point.classList.add("flip-stack");
            return;
        }

        if (!fitsRight && !fitsLeft && availableLeft > availableRight) {
            point.classList.add("flip-stack");
        }
    });
}

function restoreOpenNavalStack(chart) {
    if (!(chart instanceof HTMLElement)) return;
    const openKey = String(chart.dataset.mobileOpenNavalKey || "");
    if (!openKey) return;
    const point = [...chart.querySelectorAll(".naval-point")].find(
        (item) => String(item.dataset.navalKey || "") === openKey
    );
    if (!(point instanceof HTMLElement)) {
        delete chart.dataset.mobileOpenNavalKey;
        return;
    }
    point.classList.add("is-open");
}

function closeOpenNavalStacks(root = document, exceptPoint = null) {
    if (!(root instanceof Document || root instanceof HTMLElement)) return;
    root.querySelectorAll(".naval-point.is-open").forEach((point) => {
        if (exceptPoint && point === exceptPoint) return;
        point.classList.remove("is-open");
    });
}

function setupMobileNavalPointBehavior(chart) {
    if (!(chart instanceof HTMLElement)) return;
    if (chart.dataset.mobileNavalClickBound === "1") return;
    chart.dataset.mobileNavalClickBound = "1";

    chart.addEventListener("click", (event) => {
        if (!window.matchMedia("(max-width: 600px)").matches) return;
        const point = event.target.closest(".naval-point");
        if (!(point instanceof HTMLElement) || !chart.contains(point)) return;
        closeOpenNavalStacks(chart, point);
        point.classList.add("is-open");
        chart.dataset.mobileOpenNavalKey = String(point.dataset.navalKey || "");
    });

    document.addEventListener("click", (event) => {
        if (!window.matchMedia("(max-width: 600px)").matches) return;
        const clickedPoint = event.target.closest(".naval-point");
        if (clickedPoint instanceof HTMLElement && chart.contains(clickedPoint)) return;
        closeOpenNavalStacks(chart);
        delete chart.dataset.mobileOpenNavalKey;
    });
}

function setupCoverPreviewFromFile(file) {
    const preview = byId("coverPreview");
    if (!preview) return;
    if (!file) {
        preview.classList.add("hidden");
        preview.removeAttribute("src");
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        preview.src = String(reader.result || "");
        preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
}

function letterToY(letter) {
    const upper = String(letter || "").toUpperCase();
    const idx = "ABCDEFGHIJ".indexOf(upper);
    return idx >= 0 ? 10 - idx : 1;
}

function navalGradeLabel(rec) {
    const letter = String(rec?.rating_letter || "").toUpperCase();
    const score = Math.max(1, Math.min(10, Number(rec?.interest_score || 0)));
    if (!letter || !"ABCDEFGHIJ".includes(letter) || !Number.isFinite(score)) return "";
    return `${letter}${score}`;
}

function toDateTimeLocalValue(timestampSeconds) {
    const ts = Number(timestampSeconds || 0);
    if (!Number.isInteger(ts) || ts <= 0) return "";
    const d = new Date(ts * 1000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function renderNavalChart(round) {
    const chart = byId("navalChart");
    if (!chart) return;

    const rated = (round.recommendations || []).filter((rec) => rec.rating_letter && rec.interest_score);
    if (!rated.length) {
        chart.innerHTML = "<p style='padding:12px;color:#9fb3e0;'>Ainda não há notas nesta rodada.</p>";
        return;
    }

    const grouped = new Map();
    for (const rec of rated) {
        const x = Math.max(1, Math.min(10, Number(rec.interest_score)));
        const y = letterToY(rec.rating_letter);
        const key = `${x}|${y}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(rec);
    }

    const pointsHtml = [...grouped.entries()]
        .map(([key, list]) => {
            list.sort((a, b) => (b.rating_updated_at || b.updated_at || 0) - (a.rating_updated_at || a.updated_at || 0));
            const top = list[0];
            const [xRaw, yRaw] = key.split("|");
            const x = Number(xRaw);
            const y = Number(yRaw);
            const left = ((x - 0.5) / 10) * 100;
            const topPos = ((10.5 - y) / 10) * 100;
            const pointGrade = navalGradeLabel(top);
            const stack = list
                .map(
                    (rec) => {
                        const grade = navalGradeLabel(rec);
                        return `
                            <div class="naval-stack-item">
                                <div class="naval-stack-thumb">
                                    <img src="${escapeHtml(rec.game_cover_url || baseAvatar)}" alt="${escapeHtml(rec.game_name)}">
                                    <span class="naval-grade-badge naval-grade-badge-stack">${escapeHtml(grade)}</span>
                                </div>
                                <div>${escapeHtml(rec.game_name)}</div>
                            </div>
                        `;
                    }
                )
                .join("");

            return `
                <div class="naval-point" data-naval-key="${escapeHtml(key)}" style="left:${left}%;top:${topPos}%;">
                    <img src="${escapeHtml(top.game_cover_url || baseAvatar)}" alt="${escapeHtml(top.game_name)}">
                    <span class="naval-grade-badge">${escapeHtml(pointGrade)}</span>
                    ${list.length > 1 ? `<span class="naval-count">${list.length}</span>` : ""}
                    <div class="naval-stack">
                        <div class="naval-stack-items">${stack}</div>
                    </div>
                </div>
            `;
        })
        .join("");

    chart.innerHTML = pointsHtml;
    adjustNavalStacks(chart);
    setupMobileNavalPointBehavior(chart);
    restoreOpenNavalStack(chart);
}

function renderRevealList(round) {
    const listEl = byId("revealList");
    if (!listEl) return;
    const assignments = round.assignments || [];
    if (!assignments.length) {
        listEl.innerHTML = "<p>O sorteio ainda não foi gerado.</p>";
        return;
    }

    listEl.innerHTML = assignments
        .map((item) => {
            const giverUser = {
                id: item.giver_user_id,
                nickname: item.giver_nickname,
                username: item.giver_username
            };
            const receiverUser = item.revealed
                ? {
                    id: item.receiver_user_id,
                    nickname: item.receiver_nickname,
                    username: item.receiver_username
                }
                : "Oculto";
            const canReveal = Boolean(round.isCreator || sessionIsOwner || sessionIsModerator);
            const revealBtn = canReveal && !item.revealed
                ? `<button class="btn btn-outline" data-reveal-giver="${item.giver_user_id}" type="button">Mostrar sorteado</button>`
                : "";
            const giverHtml = displayNameStyledHtml(giverUser);
            const receiverHtml = typeof receiverUser === "string"
                ? escapeHtml(receiverUser)
                : displayNameStyledHtml(receiverUser);
            return `
                <div class="search-item">
                    <div><strong>${giverHtml}</strong> -> <strong>${receiverHtml}</strong></div>
                    ${revealBtn}
                </div>
            `;
        })
        .join("");
}

function renderRoundState(round) {
    resetRoundSections();
    byId("roundHeading").textContent = `Rodada - ${formatRoundDateTime(round.created_at)}`;
    byId("roundStatusText").textContent =
        round.phase === "draft"
            ? "Fase de sorteio e montagem de participantes."
            : round.phase === "reveal"
              ? "Sorteio concluído. Revele os pareamentos."
              : round.phase === "indication"
                ? "Sessão de indicações aberta."
                : round.phase === "rating"
                  ? "Sessão de notas navais aberta."
              : "Rodada encerrada.";

    renderRoundRecommendations(round);

    if (round.phase === "draft") {
        byId("draftCreatorSection")?.classList.remove("hidden");
        renderParticipantList(round);
        renderPairExclusionsEditor(round);
        renderUserSearchResults();
        applyDraftReadOnlyUi(round);

        byId("draftSpectatorSection")?.classList.add("hidden");
        return;
    }

    if (round.phase === "reveal") {
        byId("revealSection")?.classList.remove("hidden");
        renderRevealList(round);
        const tools = byId("startIndicationTools");
        if (round.isCreator || sessionIsOwner || sessionIsModerator) {
            tools?.classList.remove("hidden");
            const input = byId("ratingStartsAtInput");
            if (input && document.activeElement !== input) {
                const fromRound = toDateTimeLocalValue(round.rating_starts_at);
                if (fromRound) input.value = fromRound;
                else if (!input.value) {
                    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
                    input.value = future.toISOString().slice(0, 16);
                }
            }
        } else tools?.classList.add("hidden");
        return;
    }

    if (round.phase === "indication" || round.phase === "rating" || round.phase === "closed") {
        byId("indicationSection")?.classList.remove("hidden");
        const indicationsBtn = byId("tabIndicationsBtn");
        if (round.phase === "rating" || round.phase === "closed") {
            if (indicationsBtn) {
                indicationsBtn.disabled = true;
                indicationsBtn.classList.add("disabled");
            }
            setRoundTab("ratings");
        } else {
            if (indicationsBtn) {
                indicationsBtn.disabled = false;
                indicationsBtn.classList.remove("disabled");
            }
            setRoundTab(currentRoundTab);
        }

        const closeBtn = byId("closeRoundBtn");
        const finalizeBtn = byId("finalizeRoundBtn");
        const canOwnerOrCreator = Boolean(round.isCreator || sessionIsOwner);
        const canOwnerOrModerator = Boolean(sessionIsOwner || sessionIsModerator);
        const isReopenedRound = String(round.status || "") === "reopened";
        const canReopenClosedRound = round.phase === "closed" && canOwnerOrModerator;
        const canFinalizeReopenedRound = round.phase === "rating" && isReopenedRound && canOwnerOrModerator;

        if (canReopenClosedRound || canFinalizeReopenedRound || canOwnerOrCreator) {
            if (canReopenClosedRound) {
                closeBtn?.classList.add("hidden");
                finalizeBtn?.classList.remove("hidden");
                if (finalizeBtn) {
                    finalizeBtn.textContent = "Reabrir Rodada";
                    finalizeBtn.classList.remove("btn-success");
                    finalizeBtn.classList.add("btn-warn");
                }
            } else if (canFinalizeReopenedRound) {
                closeBtn?.classList.add("hidden");
                finalizeBtn?.classList.remove("hidden");
                if (finalizeBtn) {
                    finalizeBtn.textContent = "Finalizar Rodada Reaberta";
                    finalizeBtn.classList.remove("btn-warn");
                    finalizeBtn.classList.add("btn-success");
                }
            } else if (round.phase === "rating") {
                closeBtn?.classList.add("hidden");
                finalizeBtn?.classList.remove("hidden");
                if (finalizeBtn) {
                    finalizeBtn.textContent = "Finalizar Rodada";
                    finalizeBtn.classList.remove("btn-warn");
                    finalizeBtn.classList.add("btn-success");
                }
            } else {
                closeBtn?.classList.remove("hidden");
                finalizeBtn?.classList.add("hidden");
                if (finalizeBtn) {
                    finalizeBtn.textContent = "Finalizar Rodada";
                    finalizeBtn.classList.remove("btn-warn");
                    finalizeBtn.classList.add("btn-success");
                }
            }
        } else {
            closeBtn?.classList.add("hidden");
            finalizeBtn?.classList.add("hidden");
        }

        const canIndicate = round.phase === "indication";
        if (round.myAssignment) {
            const targetUser = {
                id: round.myAssignment.receiver_user_id,
                nickname: round.myAssignment.receiver_nickname,
                username: round.myAssignment.receiver_username
            };
            const assignmentText = byId("assignmentText");
            if (assignmentText) {
                assignmentText.innerHTML = canIndicate
                    ? `Sua indicação desta rodada vai para: ${displayNameStyledHtml(targetUser)}`
                    : `Indicações encerradas. Você indicou para: ${displayNameStyledHtml(targetUser)}`;
            }
            if (canIndicate) byId("recommendationForm")?.classList.remove("hidden");
            else byId("recommendationForm")?.classList.add("hidden");

            if (canIndicate) {
                const form = byId("recommendationForm");
                const submitBtn = form?.querySelector("button[type='submit']");
                if (submitBtn) submitBtn.textContent = round.myRecommendation ? "Atualizar Indicação" : "Salvar Indicação";
            }
        } else {
            byId("assignmentText").textContent = "Você está espectando esta rodada.";
            byId("recommendationForm")?.classList.add("hidden");
        }

        const ratingScheduleEditor = byId("ratingScheduleEditor");
        const ratingStartsAtEditInput = byId("ratingStartsAtEditInput");
        const canEditRatingSchedule =
            String(round.status || "") === "reopened"
                ? Boolean(sessionIsOwner || sessionIsModerator)
                : Boolean(round.isCreator || sessionIsOwner || sessionIsModerator);
        if (canEditRatingSchedule && round.phase !== "closed") {
            ratingScheduleEditor?.classList.remove("hidden");
            if (ratingStartsAtEditInput && document.activeElement !== ratingStartsAtEditInput) {
                const localValue = toDateTimeLocalValue(round.rating_starts_at);
                if (localValue) ratingStartsAtEditInput.value = localValue;
                else if (!ratingStartsAtEditInput.value) {
                    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
                    ratingStartsAtEditInput.value = future.toISOString().slice(0, 16);
                }
            }
        } else {
            ratingScheduleEditor?.classList.add("hidden");
        }

        renderNavalChart(round);
        const ratingText = byId("ratingStatusText");
        const ratingForm = byId("ratingForm");
        const ratingSelect = byId("ratingRecommendationSelect");

        if (round.phase === "closed") {
            ratingText.textContent = "Rodada encerrada. Veja o plano naval final.";
            ratingForm?.classList.add("hidden");
        } else if (round.ratingOpen) {
            const items = round.ratingsToDo || [];
            if (items.length) {
                ratingText.textContent = "A sessão de notas foi liberada. Avalie os jogos que você recebeu.";
                ratingForm?.classList.remove("hidden");
                ratingSelect.innerHTML = items
                    .map((rec) => `<option value="${rec.id}">${escapeHtml(rec.game_name)} (de ${escapeHtml(displayName({ id: rec.giver_user_id, nickname: rec.giver_nickname, username: rec.giver_username }))})</option>`)
                    .join("");
            } else {
                ratingText.textContent = "Você não recebeu jogos para avaliar nesta rodada.";
                ratingForm?.classList.add("hidden");
            }
        } else {
            const dateText = round.rating_starts_at
                ? new Date(round.rating_starts_at * 1000).toLocaleString("pt-BR")
                : "data não definida";
            ratingText.textContent = `Notas navais liberam em: ${dateText}.`;
            ratingForm?.classList.add("hidden");
        }
        return;
    }

    byId("assignmentText").textContent = "Rodada encerrada. Confira os resultados abaixo.";
}

async function loadUsersForRound(term = "") {
    const response = await sendJson(`/api/users?term=${encodeURIComponent(term)}`);
    roundUsers = response.users || [];
}

function renderUserSearchResults() {
    const container = byId("participantSearchResults");
    if (!container) return;

    if (!currentRound || currentRound.phase !== "draft") {
        container.innerHTML = "";
        return;
    }

    const canManage = canManageDraftRound(currentRound);
    if (!canManage) {
        container.innerHTML = "";
        return;
    }

    const existingIds = new Set((currentRound.participants || []).map((item) => item.id));
    const filtered = roundUsers.filter((user) => !existingIds.has(user.id));
    if (!filtered.length) {
        container.innerHTML = "<p>Nenhum usuário disponível para adicionar.</p>";
        return;
    }

    container.innerHTML = filtered
        .map(
            (user) => `
                <div class="search-item">
                    <div class="search-item-main">
                        <img class="avatar-mini" src="${escapeHtml(user.avatar_url || baseAvatar)}" alt="avatar">
                        <div>
                            <strong>${displayNameStyledHtml(user)}</strong>
                            <div>@${escapeHtml(user.username)}</div>
                        </div>
                    </div>
                    <button class="btn" data-add-user="${user.id}" type="button">Adicionar</button>
                </div>
            `
        )
        .join("");
}

async function refreshRoundData(forceRoundId, options = {}) {
    const skipUserSearchReload = Boolean(options?.skipUserSearchReload);
    let roundId = forceRoundId || Number(getQueryParam("roundId") || 0);

    if (!roundId) {
        const active = await sendJson("/api/rounds/active");
        roundId = active.activeRound ? active.activeRound.id : 0;
    }

    if (!roundId) {
            currentRound = null;
            roundRecommendationsStructureSignature = "";
            recommendationCommentSignatureCaches.round.clear();
            recommendationCommentIdsCaches.round.clear();
            pairExclusionsRenderSignature = "";
        if (roundPhaseRefreshTimer) {
            clearTimeout(roundPhaseRefreshTimer);
            roundPhaseRefreshTimer = 0;
        }
        byId("roundHeading").textContent = "Sem rodada ativa";
        byId("roundStatusText").textContent = "Crie uma nova rodada na página inicial.";
        resetRoundSections();
        byId("roundRecommendations").innerHTML = "";
        return;
    }

    const payload = await sendJson(`/api/rounds/${roundId}`);
    const previousPhase = currentRound?.phase || "";
    const previousRoundId = currentRound?.id || 0;
    currentRound = payload.round;
    if (previousRoundId && previousRoundId !== currentRound.id) {
        roundRecommendationsStructureSignature = "";
        recommendationCommentSignatureCaches.round.clear();
        recommendationCommentIdsCaches.round.clear();
    }
    renderRoundState(currentRound);
    if (previousPhase && previousPhase !== "closed" && currentRound.phase === "closed") {
        await claimAchievementUnlocksAndNotify();
    }
    if (roundPhaseRefreshTimer) {
        clearTimeout(roundPhaseRefreshTimer);
        roundPhaseRefreshTimer = 0;
    }
    const ratingStartsAt = Number(currentRound?.rating_starts_at || 0);
    const roundStatus = String(currentRound?.status || "");
    if (roundStatus === "indication" && ratingStartsAt > 0) {
        const now = Math.floor(Date.now() / 1000);
        const delayMs = Math.max(0, (ratingStartsAt - now) * 1000 + 120);
        roundPhaseRefreshTimer = window.setTimeout(() => {
            if (!currentRound?.id) return;
            refreshRoundData(currentRound.id, {
                skipUserSearchReload: canManageDraftRound(currentRound)
            }).catch(() => {
                // sem acao
            });
        }, delayMs);
    }
    if (canManageDraftRound(currentRound) && !skipUserSearchReload) {
        await loadUsersForRound(byId("participantSearch")?.value || "");
    }
    renderUserSearchResults();
}
let steamSuggestTimer = null;
let steamSelectionToken = 0;

function renderSteamResults(items) {
    const resultsBox = byId("steamResults");
    if (!resultsBox) return;
    if (!items.length) {
        resultsBox.innerHTML = "";
        resultsBox.classList.add("hidden");
        return;
    }
    resultsBox.classList.remove("hidden");
    resultsBox.innerHTML = items
        .map(
            (item) => {
                const fallbackPortrait = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appId}/library_600x900_2x.jpg`;
                const fallbackHeader = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appId}/header.jpg`;
                const cover = item.libraryImage || item.largeCapsule || fallbackPortrait || fallbackHeader || baseAvatar;
                const fallbackCover = item.largeCapsule || fallbackHeader || baseAvatar;
                return `
                <div class="search-item steam-pick-item" data-steam-pick='${JSON.stringify({
                    appId: item.appId,
                    name: item.name,
                    cover,
                    fallbackCover,
                    description: item.description || ""
                }).replaceAll("'", "&#39;")}'>
                    <div class="search-item-main">
                        <img class="steam-result-cover" src="${escapeHtml(cover)}" data-fallback-src="${escapeHtml(fallbackCover)}" alt="capa">
                        <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <div>AppID: ${escapeHtml(item.appId)}</div>
                        </div>
                    </div>
                </div>
            `;
            }
        )
        .join("");
}

async function requestSteamSuggestions(term) {
    const trimmed = (term || "").trim();
    if (trimmed.length < 2) {
        const box = byId("steamResults");
        if (box) {
            box.innerHTML = "";
            box.classList.add("hidden");
        }
        return;
    }
    const data = await sendJson(`/api/steam/search?term=${encodeURIComponent(trimmed)}`);
    renderSteamResults(data.items || []);
}

async function handleRoundPage() {
    await ensureSessionUserId();
    await refreshRoundData();

    byId("tabIndicationsBtn")?.addEventListener("click", () => setRoundTab("indications"));
    byId("tabRatingsBtn")?.addEventListener("click", () => setRoundTab("ratings"));

    byId("searchParticipantsBtn")?.addEventListener("click", async () => {
        if (!canManageDraftRound(currentRound)) return;
        try {
            const term = byId("participantSearch")?.value || "";
            await loadUsersForRound(term);
            renderUserSearchResults();
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("participantSearchResults")?.addEventListener("click", async (event) => {
        const btn = event.target.closest("button[data-add-user]");
        if (!btn || !currentRound) return;
        if (!canManageDraftRound(currentRound)) return;
        const userId = Number(btn.dataset.addUser);
        try {
            await sendJson(`/api/rounds/${currentRound.id}/participants`, "POST", { userId });
            await refreshRoundData(currentRound.id);
            setFeedback("roundFeedback", "Participante adicionado.", "ok");
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("participantList")?.addEventListener("click", async (event) => {
        const btn = event.target.closest("button[data-remove-user]");
        if (!btn || !currentRound) return;
        if (!canManageDraftRound(currentRound)) return;
        const userId = Number(btn.dataset.removeUser);
        try {
            await fetch(`/api/rounds/${currentRound.id}/participants/${userId}`, {
                method: "DELETE",
                credentials: "include"
            }).then(async (response) => {
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.message || "Erro ao remover participante.");
            });
            await refreshRoundData(currentRound.id);
            setFeedback("roundFeedback", "Participante removido.", "ok");
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("pairExclusionsList")?.addEventListener("change", async (event) => {
        const input = event.target?.closest?.("input[type='checkbox'][data-pair-giver][data-pair-receiver]");
        if (!input) return;
        if (!canManageDraftRound(currentRound)) return;

        const changedGiverUserId = Number(input.getAttribute("data-pair-giver") || 0);
        const validation = validatePairExclusionsFromScreen({
            showFeedback: false,
            changedGiverUserId
        });
        if (!validation.ok) {
            input.checked = !input.checked;
            clearPairExclusionInlineErrors();
            if (validation.invalidGiverId > 0) {
                showPairExclusionInlineError(validation.invalidGiverId, validation.message);
                setFeedback("roundFeedback", "", "");
            } else {
                setFeedback("roundFeedback", validation.message, "error");
            }
            return;
        }

        clearPairExclusionInlineErrors();
        setFeedback("roundFeedback", "", "");
        await autosavePairExclusionsForCurrentRound();
    });

    byId("drawBtn")?.addEventListener("click", async (event) => {
        if (!canManageDraftRound(currentRound)) return;
        const btn = event.currentTarget;
        setFeedback("roundFeedback", "", "");
        try {
            await withButtonLoading(btn, "Sorteando...", async () => {
                await persistPairExclusionsForCurrentRound();
                const result = await sendJson(`/api/rounds/${currentRound.id}/draw`, "POST", {});
                currentRound = result.round;
                renderRoundState(currentRound);
                setFeedback("roundFeedback", result.message, "ok");
            });
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("revealList")?.addEventListener("click", async (event) => {
        const btn = event.target.closest("button[data-reveal-giver]");
        if (!btn || !currentRound) return;
        try {
            const giverUserId = Number(btn.dataset.revealGiver);
            const result = await sendJson(`/api/rounds/${currentRound.id}/reveal/${giverUserId}`, "POST", {});
            currentRound = result.round;
            renderRoundState(currentRound);
            setFeedback("roundFeedback", result.message, "ok");
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("startIndicationBtn")?.addEventListener("click", async (event) => {
        if (!currentRound) return;
        const btn = event.currentTarget;
        try {
            const raw = byId("ratingStartsAtInput")?.value || "";
            const ts = Math.floor(new Date(raw).getTime() / 1000);
            await withButtonLoading(btn, "Abrindo sessão...", async () => {
                const result = await sendJson(`/api/rounds/${currentRound.id}/start-indication`, "POST", {
                    ratingStartsAt: ts
                });
                currentRound = result.round;
                renderRoundState(currentRound);
                setFeedback("roundFeedback", result.message, "ok");
            });
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("updateRatingStartsAtBtn")?.addEventListener("click", async (event) => {
        const isReopenedRound = String(currentRound?.status || "") === "reopened";
        if (
            !currentRound
            || currentRound.phase === "closed"
            || (isReopenedRound && !sessionIsOwner && !sessionIsModerator)
            || (!currentRound.isCreator && !sessionIsOwner && !sessionIsModerator)
        ) {
            return;
        }
        const btn = event.currentTarget;
        try {
            const raw = byId("ratingStartsAtEditInput")?.value || "";
            const ts = Math.floor(new Date(raw).getTime() / 1000);
            if (!Number.isInteger(ts) || ts <= 0) {
                throw new Error("Defina uma data válida para as notas navais.");
            }
            await withButtonLoading(btn, "Atualizando...", async () => {
                const result = await sendJson(`/api/rounds/${currentRound.id}`, "PUT", {
                    ratingStartsAt: ts
                });
                currentRound = result.round;
                renderRoundState(currentRound);
                setFeedback("roundFeedback", "Data da sessão de notas atualizada.", "ok");
            });
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });
    const closeCurrentRound = async (button) => {
        if (!currentRound) return;
        try {
            const loadingText = currentRound.phase === "closed" ? "Reabrindo..." : "Finalizando...";
            await withButtonLoading(button, loadingText, async () => {
                const result = await sendJson(`/api/rounds/${currentRound.id}/close`, "POST", {});
                setFeedback("roundFeedback", result.message, "ok");
                await refreshRoundData(currentRound.id);
            });
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    };

    byId("closeRoundBtn")?.addEventListener("click", (event) => closeCurrentRound(event.currentTarget));
    byId("finalizeRoundBtn")?.addEventListener("click", (event) => closeCurrentRound(event.currentTarget));

    byId("coverInput")?.addEventListener("change", (event) => {
        const file = event.target.files?.[0] || null;
        setupCoverPreviewFromFile(file);
        if (file) byId("coverUrlInput").value = "";
    });

    byId("steamTerm")?.addEventListener("input", () => {
        if (steamSuggestTimer) clearTimeout(steamSuggestTimer);
        steamSuggestTimer = setTimeout(async () => {
            try {
                await requestSteamSuggestions(byId("steamTerm")?.value || "");
            } catch {
                // sugestão silenciosa
            }
        }, 240);
    });

    byId("steamResults")?.addEventListener(
        "error",
        (event) => {
            const target = event.target;
            if (!(target instanceof HTMLImageElement) || !target.classList.contains("steam-result-cover")) return;

            const fallbackSrc = target.getAttribute("data-fallback-src") || "";
            if (fallbackSrc && target.dataset.fallbackStep !== "header") {
                target.dataset.fallbackStep = "header";
                target.src = fallbackSrc;
                return;
            }

            if (target.dataset.fallbackStep === "avatar") return;
            target.dataset.fallbackStep = "avatar";
            target.src = baseAvatar;
        },
        true
    );

    byId("steamResults")?.addEventListener("click", async (event) => {
        const itemEl = event.target.closest("[data-steam-pick]");
        if (!itemEl) return;

        let picked = {};
        try {
            const raw = itemEl.dataset.steamPick || "{}";
            picked = JSON.parse(raw.replaceAll("&#39;", "'"));
        } catch {
            return;
        }

        const form = byId("recommendationForm");
        if (!form) return;

        const coverInput = byId("coverInput");
        if (coverInput) coverInput.value = "";

        const appIdText = String(picked.appId || "");
        form.elements.gameName.value = picked.name || "";
        form.elements.gameDescription.value = picked.description || "";
        form.elements.steamAppId.value = appIdText;

        const selectedCover = picked.cover && picked.cover !== baseAvatar
            ? picked.cover
            : (picked.fallbackCover || "");
        const fallbackFromPick = picked.fallbackCover || "";
        byId("coverUrlInput").value = selectedCover;

        const preview = byId("coverPreview");
        if (selectedCover && preview) {
            preview.src = selectedCover;
            preview.classList.remove("hidden");
            preview.onerror = () => {
                preview.onerror = null;
                if (fallbackFromPick) {
                    preview.src = fallbackFromPick;
                    byId("coverUrlInput").value = fallbackFromPick;
                    return;
                }
                preview.src = baseAvatar;
            };
        }

        const resultsBox = byId("steamResults");
        resultsBox.innerHTML = "";
        resultsBox.classList.add("hidden");
        byId("steamTerm").value = picked.name || "";

        if (!appIdText) return;

        const selectionToken = ++steamSelectionToken;
        const descriptionSnapshot = form.elements.gameDescription.value;
        const coverSnapshot = byId("coverUrlInput").value;
        const needsDescription = !descriptionSnapshot.trim() || looksMostlyEnglishText(descriptionSnapshot);
        const needsCover = !coverSnapshot.trim();
        if (!needsDescription && !needsCover) return;

        try {
            const details = await sendJson(`/api/steam/app/${encodeURIComponent(appIdText)}`);
            if (selectionToken !== steamSelectionToken) return;
            if (String(form.elements.steamAppId.value || "") !== appIdText) return;

            if (needsDescription && form.elements.gameDescription.value === descriptionSnapshot) {
                form.elements.gameDescription.value = details.item?.description || "";
            }
            if (needsCover && byId("coverUrlInput").value === coverSnapshot) {
                const fallbackCover = details.item?.libraryImage || details.item?.headerImage || "";
                if (fallbackCover) {
                    byId("coverUrlInput").value = fallbackCover;
                    if (preview) {
                        preview.src = fallbackCover;
                        preview.classList.remove("hidden");
                    }
                }
            }
        } catch {
            // fallback silencioso
        }
    });

    document.addEventListener("click", (event) => {
        const shell = event.target.closest(".steam-search-shell");
        if (!shell) {
            const box = byId("steamResults");
            if (box) {
                box.innerHTML = "";
                box.classList.add("hidden");
            }
        }
    });

    byId("recommendationForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentRound || currentRound.phase !== "indication") return;
        const form = event.target;
        const data = new FormData(form);
        data.set("coverUrl", byId("coverUrlInput").value || "");

        try {
            const result = await sendForm(`/api/rounds/${currentRound.id}/recommendations`, data);
            currentRound = result.round;
            renderRoundState(currentRound);
            setFeedback("roundFeedback", "Indicação salva sem precisar atualizar a página.", "ok");
            showAchievementUnlockNotifications(result.newlyUnlocked || []);
            claimAchievementUnlocksAndNotify();
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("ratingForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentRound) return;
        const form = event.target;
        const payload = {
            recommendationId: Number(form.elements.recommendationId.value),
            ratingLetter: form.elements.ratingLetter.value,
            interestScore: Number(form.elements.interestScore.value)
        };
        try {
            const result = await sendJson(`/api/rounds/${currentRound.id}/ratings`, "POST", payload);
            currentRound = result.round;
            renderRoundState(currentRound);
            setFeedback("roundFeedback", result.message, "ok");
            showAchievementUnlockNotifications(result.newlyUnlocked || []);
            claimAchievementUnlocksAndNotify();
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    byId("roundRecommendations")?.addEventListener("click", async (event) => {
        await handleRecommendationCommentAction(event, "round", "roundFeedback");
    });

    byId("roundRecommendations")?.addEventListener("submit", async (event) => {
        const form = event.target;
        event.preventDefault();
        await submitRecommendationCommentForm(form, "round", "roundFeedback");
    });
}
async function init() {
    ensureRawgAttributionLink();
    await handleLogoutButton();
    setupPasswordVisibilityToggles();
    setupPasswordPasteBlock();
    if (byId("adminNavLink")) {
        await setupOwnerNavLink();
    }
    const authenticatedPage = page === "profile" || page === "home" || page === "round" || page === "admin";
    if (authenticatedPage) {
        try {
            await ensureUserRolesMap();
        } catch {
            // sem mapa de cargos, segue com nomes basicos
        }
        claimAchievementUnlocksAndNotify();
        startRoundRealtimeStream();
    }

    if (page === "login" || page === "register") {
        showOAuthFeedbackFromQuery();
        setupGoogleButtonsLoading();
    }

    if (page === "login") await handleLogin();
    if (page === "register") await handleRegister();
    if (page === "verify") await handleVerifyEmail();
    if (page === "forgot-password") await handleForgotPassword();
    if (page === "reset-password") await handleResetPassword();
    if (page === "profile") await loadProfile();
    if (page === "home") await handleHome();
    if (page === "round") await handleRoundPage();
    if (page === "admin") await handleAdminPage();
}

init();






