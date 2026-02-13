const page = document.body.dataset.page;
const baseAvatar =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' rx='16' fill='%23101933'/%3E%3Ccircle cx='60' cy='46' r='22' fill='%2339d2ff'/%3E%3Crect x='25' y='77' width='70' height='28' rx='14' fill='%234f79ff'/%3E%3C/svg%3E";
let sessionUserId = 0;
let sessionUserLoaded = false;
const recommendationCommentFormState = new Map();
const recommendationCommentSignatureCaches = {
    home: new Map(),
    round: new Map()
};

function byId(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function displayName(userLike) {
    if (!userLike) return "Jogador";
    return userLike.nickname || userLike.username || "Jogador";
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

function profileUrlByUserId(userId) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) return "/profile.html";
    return `/profile.html?userId=${numericUserId}`;
}

function userLinkHtml(userLike, userId) {
    const numericUserId = Number(userId);
    const label = escapeHtml(displayName(userLike));
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        return `<span>${label}</span>`;
    }
    return `<a class="user-link" href="${escapeHtml(profileUrlByUserId(numericUserId))}">${label}</a>`;
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

function commentItemHtml(comment, options = {}) {
    const recommendationId = Number(options.recommendationId || comment.recommendation_id || 0);
    const interactive = options.interactive === true && recommendationId > 0;
    const ownComment = sessionUserId > 0 && Number(comment.user_id) === sessionUserId;
    const depth = Math.max(0, Math.min(4, Number(options.depth || 0)));
    const parentAuthor = String(options.parentAuthor || "").trim();
    const actions = interactive
        ? `
            <div class="comment-actions">
                <button class="comment-action" type="button" data-comment-action="reply" data-comment-id="${Number(comment.id) || 0}" data-recommendation-id="${recommendationId}">Responder</button>
                ${ownComment ? `<button class="comment-action" type="button" data-comment-action="edit" data-comment-id="${Number(comment.id) || 0}" data-recommendation-id="${recommendationId}">Editar</button>` : ""}
                ${ownComment ? `<button class="comment-action danger" type="button" data-comment-action="delete" data-comment-id="${Number(comment.id) || 0}" data-recommendation-id="${recommendationId}">Excluir</button>` : ""}
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
            parentAuthor: parent ? (parent.username || displayName(parent)) : ""
        });
        node._children.sort(sorter).forEach((child) => walk(child, depth + 1, node));
    };

    roots.sort(sorter).forEach((root) => walk(root, 0, null));
    return output;
}

function recommendationCommentsSignature(comments) {
    return (comments || [])
        .map((comment) => `${Number(comment.id) || 0}:${Number(comment.updated_at || 0)}:${Number(comment.parent_comment_id || 0)}`)
        .join("|");
}

function recommendationCommentsHtml(recommendationId, comments, options = {}) {
    const rows = buildCommentDisplayRows(comments);
    if (!rows.length) {
        return '<div class="comment-item">Sem comentarios ainda.</div>';
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
    const recommendationId = Number(recommendation.id);
    if (!recommendationId) return;

    const list = byId(`comment-list-${recommendationId}`);
    if (!list) return;

    const comments = recommendation.comments || [];
    const signature = recommendationCommentsSignature(comments);
    if (!force && cache.get(recommendationId) === signature) return;

    cache.set(recommendationId, signature);
    list.innerHTML = recommendationCommentsHtml(recommendationId, comments, { interactive: true });
}

function clearStaleCommentSignatures(scope, recommendationIds) {
    const cache = scope === "home" ? recommendationCommentSignatureCaches.home : recommendationCommentSignatureCaches.round;
    const keep = new Set((recommendationIds || []).map((id) => Number(id)));
    [...cache.keys()].forEach((key) => {
        if (!keep.has(Number(key))) cache.delete(key);
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
        if (input instanceof HTMLInputElement) input.placeholder = "Edite seu comentario";
        if (context) {
            context.classList.remove("hidden");
            context.innerHTML = `
                <span>Editando comentario</span>
                <button class="comment-action" type="button" data-comment-context-cancel="${id}">Cancelar</button>
            `;
        }
        return;
    }

    delete form.dataset.editCommentId;
    if (submit) submit.textContent = state.mode === "reply" ? "Responder" : "Comentar";
    if (input instanceof HTMLInputElement) {
        input.placeholder = state.mode === "reply" ? "Escreva sua resposta" : "Comentar esta avaliacao";
    }
    if (context) {
        if (state.mode === "reply" && state.parentCommentId > 0) {
            context.classList.remove("hidden");
            context.innerHTML = `
                <span>Respondendo ${escapeHtml(state.label || "comentario")}</span>
                <button class="comment-action" type="button" data-comment-context-cancel="${id}">Cancelar</button>
            `;
        } else {
            context.classList.add("hidden");
            context.innerHTML = "";
        }
    }
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

async function ensureSessionUserId() {
    if (sessionUserLoaded) return sessionUserId;
    try {
        const data = await sendJson("/api/user/profile");
        const parsed = Number(data?.profile?.id || 0);
        sessionUserId = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    } catch {
        sessionUserId = 0;
    }
    sessionUserLoaded = true;
    return sessionUserId;
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
                if (!response.ok) throw new Error(data.message || "Erro ao excluir comentario.");
            });
            const updatedRecommendation = removeRecommendationComment(scope, recommendationId, commentId);
            syncRecommendationCommentList(updatedRecommendation, scope, true);
            if (getCommentFormState(recommendationId).commentId === commentId) {
                resetCommentFormState(recommendationId);
                if (input instanceof HTMLInputElement) input.value = "";
            }
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
    el.textContent = message || "";
    el.className = `feedback${type ? ` ${type}` : ""}`;
}

async function sendJson(url, method = "GET", payload) {
    const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: payload ? JSON.stringify(payload) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || "Erro na requisicao.");
    }
    return data;
}

async function sendForm(url, formData) {
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || "Erro na requisicao.");
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
        google_not_configured: "Login Google ainda nao foi configurado no servidor.",
        google_auth_failed: "Falha ao autenticar com Google.",
        google_email_unavailable: "Sua conta Google nao retornou um email valido."
    };
    setFeedback("feedback", messages[error] || "Erro de autenticacao.");
}

function recommendationCardTemplate(rec, options = {}) {
    const showGradeOverlay = options.showGradeOverlay !== false;
    const showInlineGrade = options.showInlineGrade === true;
    const grade = rec.rating_letter && rec.interest_score ? `${rec.rating_letter}${rec.interest_score}` : "";
    const cover = rec.game_cover_url || baseAvatar;
    const commentsHtml = recommendationCommentsHtml(rec.id, rec.comments || [], { interactive: true });

    return `
        <article class="recommendation-card" data-recommendation-id="${rec.id}">
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
                <p>${escapeHtml(rec.game_description)}</p>
            </div>
            ${rec.reason ? `<p><strong>Motivo da indicacao:</strong> ${escapeHtml(rec.reason)}</p>` : ""}
            <div class="comment-list" id="comment-list-${rec.id}">${commentsHtml || '<div class="comment-item">Sem comentarios ainda.</div>'}</div>
            <div class="comment-context hidden" id="comment-context-${rec.id}"></div>
            <form class="comment-form" data-comment-form="${rec.id}">
                <input type="hidden" name="parentCommentId" value="">
                <input type="text" name="commentText" maxlength="500" placeholder="Comentar esta avaliacao">
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
        try {
            await sendJson("/api/auth/login", "POST", payload);
            window.location.href = "/";
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });
}

async function handleRegister() {
    const form = byId("registerForm");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        const payload = Object.fromEntries(new FormData(form).entries());
        try {
            await sendJson("/api/auth/register", "POST", payload);
            setFeedback("feedback", "Codigo enviado. Confira seu email e confirme seu cadastro.", "ok");
            setTimeout(() => {
                window.location.href = `/verify-email.html?email=${encodeURIComponent(payload.email)}`;
            }, 900);
        } catch (error) {
            setFeedback("feedback", error.message, "error");
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
        try {
            await sendJson("/api/auth/verify-email", "POST", payload);
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
        try {
            const result = await sendJson("/api/auth/request-password-reset", "POST", payload);
            setFeedback("feedback", result.message, "ok");
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });
}

async function handleResetPassword() {
    const token = getResetTokenFromQuery();
    if (!token) {
        setFeedback("feedback", "Token de troca de senha nao encontrado.", "error");
        return;
    }

    const form = byId("resetPasswordForm");
    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("feedback", "", "");
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.token = token;
        try {
            await sendJson("/api/auth/reset-password", "POST", payload);
            setFeedback("feedback", "Senha alterada com sucesso.", "ok");
            setTimeout(() => {
                window.location.href = "/login.html";
            }, 900);
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });
}

async function loadProfile() {
    const form = byId("profileForm");
    const avatarPreview = byId("avatarPreview");
    const adminPanel = byId("adminPanel");
    const adminUsersList = byId("adminUsersList");
    const adminRoundsList = byId("adminRoundsList");
    const profileTitle = byId("profileTitle");
    const profileGivenList = byId("profileGivenList");
    const profileReceivedList = byId("profileReceivedList");
    const profileCommentsList = byId("profileCommentsList");
    const profileCommentForm = byId("profileCommentForm");
    const profileActivitySection = byId("profileActivitySection");
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

    function activityCardHtml(item, mode) {
        const who = mode === "given"
            ? `Para: ${userLinkHtml({ nickname: item.receiver_nickname, username: item.receiver_username }, item.receiver_id)}`
            : `De: ${userLinkHtml({ nickname: item.giver_nickname, username: item.giver_username }, item.giver_id)}`;
        const grade = item.rating_letter && item.interest_score ? `${item.rating_letter}${item.interest_score}` : "Sem nota";
        const cover = item.game_cover_url || baseAvatar;
        return `
            <article class="recommendation-card">
                <div class="recommendation-cover-wrap">
                    <img class="recommendation-cover-bg" src="${escapeHtml(cover)}" alt="">
                    <img class="recommendation-cover" src="${escapeHtml(cover)}" alt="Capa ${escapeHtml(item.game_name)}">
                    ${item.rating_letter && item.interest_score ? `<span class="grade-overlay">${escapeHtml(grade)}</span>` : ""}
                </div>
                <h3>${escapeHtml(item.game_name)}</h3>
                <div class="meta-row"><span class="pill">${who}</span><span class="pill">Rodada: ${escapeHtml(formatRoundDateTime(item.created_at))}</span></div>
                <p>${escapeHtml(item.game_description || "")}</p>
                ${item.reason ? `<p><strong>Motivo:</strong> ${escapeHtml(item.reason)}</p>` : ""}
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
                ? "<p>Nenhuma indicacao feita ainda.</p>"
                : "<p>Nenhuma indicacao recebida ainda.</p>";
        const pagination = items.length > profilePageSize
            ? `
                <div class="pagination-controls">
                    <button class="btn btn-outline" type="button" data-profile-page-mode="${mode}" data-profile-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
                    <span>Pagina ${currentPage} de ${totalPages}</span>
                    <button class="btn btn-outline" type="button" data-profile-page-mode="${mode}" data-profile-page-action="next" ${currentPage >= totalPages ? "disabled" : ""}>Proxima</button>
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

    function renderProfileComments(comments) {
        if (!profileCommentsList) return;
        if (!comments?.length) {
            profileCommentsList.innerHTML = '<div class="comment-item">Sem comentarios ainda.</div>';
            return;
        }
        profileCommentsList.innerHTML = comments
            .map((comment) => commentItemHtml(comment))
            .join("");
    }

    async function refreshProfile() {
        const data = await sendJson("/api/user/profile");
        const parsedOwnUserId = Number(data.profile?.id);
        ownUserId = Number.isInteger(parsedOwnUserId) && parsedOwnUserId > 0 ? parsedOwnUserId : 0;
        if (ownUserId > 0) {
            sessionUserId = ownUserId;
            sessionUserLoaded = true;
        }
        const targetUserId = viewedUserId > 0 ? viewedUserId : ownUserId;
        currentProfileUserId = targetUserId || ownUserId;

        let profileView = null;
        let profileComments = { comments: [] };
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

        const canEdit = Boolean(profileView?.canEdit);
        const profile = canEdit ? data.profile : profileView.profile;

        Object.keys(profile).forEach((key) => {
            if (form?.elements?.[key]) {
                form.elements[key].value = profile[key] || "";
            }
        });
        if (!canEdit && form?.elements?.email) form.elements.email.value = "";
        if (!canEdit && byId("emailFieldLabel")) byId("emailFieldLabel").textContent = "Email (oculto no modo visualizacao)";

        if (avatarPreview) {
            avatarPreview.src = profile.avatar_url || baseAvatar;
        }
        if (profileTitle) {
            profileTitle.textContent = canEdit
                ? "Seu Perfil no Clube do Jogo"
                : `Perfil de ${displayName(profileView.profile)}`;
        }

        form?.querySelectorAll("input,button,textarea,select").forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            if (canEdit) {
                el.removeAttribute("disabled");
            } else if (el.getAttribute("name") !== "username" && el.getAttribute("name") !== "nickname" && el.getAttribute("name") !== "phone" && el.getAttribute("name") !== "email") {
                el.setAttribute("disabled", "disabled");
            }
        });
        if (!canEdit) {
            form?.classList.add("profile-readonly");
            form?.querySelector("button[type='submit']")?.setAttribute("disabled", "disabled");
            form?.elements?.nickname?.setAttribute("readonly", "readonly");
            form?.elements?.phone?.setAttribute("readonly", "readonly");
            byId("avatarForm")?.classList.add("hidden");
            byId("sendResetFromProfile")?.closest(".card")?.classList.add("hidden");
            adminPanel?.classList.add("hidden");
        } else {
            form?.classList.remove("profile-readonly");
            form?.elements?.nickname?.removeAttribute("readonly");
            form?.elements?.phone?.removeAttribute("readonly");
            byId("avatarForm")?.classList.remove("hidden");
            byId("sendResetFromProfile")?.closest(".card")?.classList.remove("hidden");
        }

        renderProfileActivity(profileView.activity);
        renderProfileComments(profileComments.comments || []);
        return { ...data, canEdit };
    }

    function renderAdmin(data) {
        if (!adminUsersList || !adminRoundsList) return;
        adminUsersList.innerHTML = (data.users || [])
            .map(
                (user) => `
                    <div class="search-item">
                        <div>
                            <strong>${escapeHtml(displayName(user))}</strong>
                            <div>${escapeHtml(user.email)}</div>
                            <div>Status: ${user.blocked ? "Bloqueado" : "Ativo"}</div>
                        </div>
                        <div class="inline-actions">
                            <button class="btn btn-outline" data-admin-toggle-block="${user.id}" data-admin-blocked="${user.blocked ? 1 : 0}" type="button">
                                ${user.blocked ? "Desbloquear" : "Bloquear"}
                            </button>
                            <button class="btn btn-outline" data-admin-delete-user="${user.id}" type="button">Excluir</button>
                        </div>
                    </div>
                `
            )
            .join("");

        adminRoundsList.innerHTML = (data.rounds || [])
            .map(
                (round) => `
                    <div class="search-item">
                        <div>
                            <strong>Rodada - ${formatRoundDateTime(round.created_at)}</strong>
                            <div>Status: ${escapeHtml(round.status)}</div>
                            <div>Criador: ${escapeHtml(displayName({ nickname: round.creator_nickname, username: round.creator_username }))}</div>
                        </div>
                        <div class="inline-actions">
                            <button class="btn btn-outline" data-admin-close-round="${round.id}" type="button">Fechar</button>
                            <button class="btn btn-outline" data-admin-delete-round="${round.id}" type="button">Excluir</button>
                        </div>
                    </div>
                `
            )
            .join("");
    }

    async function refreshAdmin() {
        const data = await sendJson("/api/admin/dashboard");
        renderAdmin(data);
    }

    try {
        const profileData = await refreshProfile();
        if (profileData.canEdit && profileData.isOwner && adminPanel) {
            adminPanel.classList.remove("hidden");
            await refreshAdmin();
        }
    } catch (error) {
        setFeedback("feedback", error.message, "error");
    }

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        setFeedback("feedback", "", "");
        const payload = {
            nickname: form.elements.nickname.value,
            phone: form.elements.phone.value
        };
        try {
            await sendJson("/api/user/profile", "PUT", payload);
            setFeedback("feedback", "Perfil atualizado com sucesso.", "ok");
            await refreshProfile();
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });

    const avatarForm = byId("avatarForm");
    avatarForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        setFeedback("feedback", "", "");
        const data = new FormData(avatarForm);
        try {
            const result = await sendForm("/api/user/avatar", data);
            if (avatarPreview) avatarPreview.src = result.avatarUrl || baseAvatar;
            setFeedback("feedback", "Imagem de perfil atualizada.", "ok");
            avatarForm.reset();
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });

    const sendResetBtn = byId("sendResetFromProfile");
    sendResetBtn?.addEventListener("click", async () => {
        if (viewedUserId > 0 && viewedUserId !== ownUserId) return;
        try {
            const result = await sendJson("/api/user/password-reset-link", "POST");
            setFeedback("feedback", result.message, "ok");
        } catch (error) {
            setFeedback("feedback", error.message, "error");
        }
    });

    profileCommentForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = profileCommentForm.querySelector("input[name='commentText']");
        const commentText = String(input?.value || "").trim();
        if (!commentText || !currentProfileUserId) return;
        try {
            const result = await sendJson(`/api/user/profile-comments?userId=${encodeURIComponent(currentProfileUserId)}`, "POST", { commentText });
            if (profileCommentsList && profileCommentsList.textContent.includes("Sem comentarios")) {
                profileCommentsList.innerHTML = "";
            }
            profileCommentsList?.insertAdjacentHTML(
                "afterbegin",
                commentItemHtml(result.comment)
            );
            profileCommentForm.reset();
            setFeedback("profileCommentFeedback", "Comentario publicado.", "ok");
        } catch (error) {
            setFeedback("profileCommentFeedback", error.message, "error");
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

    adminPanel?.addEventListener("click", async (event) => {
        const toggleBtn = event.target.closest("button[data-admin-toggle-block]");
        const deleteUserBtn = event.target.closest("button[data-admin-delete-user]");
        const closeRoundBtn = event.target.closest("button[data-admin-close-round]");
        const deleteRoundBtn = event.target.closest("button[data-admin-delete-round]");

        try {
            if (toggleBtn) {
                const userId = Number(toggleBtn.dataset.adminToggleBlock);
                const blocked = Number(toggleBtn.dataset.adminBlocked) === 1 ? 0 : 1;
                const result = await sendJson(`/api/admin/users/${userId}/block`, "PATCH", { blocked });
                setFeedback("adminFeedback", result.message, "ok");
                await refreshAdmin();
            }
            if (deleteUserBtn) {
                const userId = Number(deleteUserBtn.dataset.adminDeleteUser);
                await fetch(`/api/admin/users/${userId}`, {
                    method: "DELETE",
                    credentials: "include"
                }).then(async (response) => {
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(data.message || "Erro ao excluir conta.");
                });
                setFeedback("adminFeedback", "Conta excluida.", "ok");
                await refreshAdmin();
            }
            if (closeRoundBtn) {
                const roundId = Number(closeRoundBtn.dataset.adminCloseRound);
                const result = await sendJson(`/api/rounds/${roundId}`, "PUT", { status: "closed" });
                setFeedback("adminFeedback", result.message, "ok");
                await refreshAdmin();
            }
            if (deleteRoundBtn) {
                const roundId = Number(deleteRoundBtn.dataset.adminDeleteRound);
                await fetch(`/api/rounds/${roundId}`, {
                    method: "DELETE",
                    credentials: "include"
                }).then(async (response) => {
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(data.message || "Erro ao excluir rodada.");
                });
                setFeedback("adminFeedback", "Rodada excluida.", "ok");
                await refreshAdmin();
            }
        } catch (error) {
            setFeedback("adminFeedback", error.message, "error");
        }
    });
}

let homeActiveRound = null;
let homeRoundsMap = new Map();
let homeActivePollTimer = null;
let homeRoundFeedPageMap = new Map();
const HOME_FEED_RECOMMENDATION_PAGE_SIZE = 6;

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
            const left = ((x - 1) / 9) * 100;
            const topPos = ((10 - y) / 9) * 100;
            const stack = list
                .map(
                    (rec) => `
                        <div class="naval-stack-item">
                            <img src="${escapeHtml(rec.game_cover_url || baseAvatar)}" alt="${escapeHtml(rec.game_name)}">
                            <div>${escapeHtml(rec.game_name)}</div>
                        </div>
                    `
                )
                .join("");
            return `
                <div class="naval-point" style="left:${left}%;top:${topPos}%;">
                    <img src="${escapeHtml(top.game_cover_url || baseAvatar)}" alt="${escapeHtml(top.game_name)}">
                    ${list.length > 1 ? `<span class="naval-count">${list.length}</span>` : ""}
                    <div class="naval-stack">${stack}</div>
                </div>
            `;
        })
        .join("");
    adjustNavalStacks(chart);
}

function renderFeed(rounds) {
    const container = byId("roundCarousels");
    if (!container) return;
    homeRoundsMap = new Map((rounds || []).map((round) => [Number(round.id), round]));
    recommendationCommentSignatureCaches.home.clear();

    if (!rounds.length) {
        container.innerHTML = '<p>Nenhuma indicacao publicada ainda.</p>';
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
                const pagination = recommendations.length > HOME_FEED_RECOMMENDATION_PAGE_SIZE
                    ? `
                        <div class="pagination-controls">
                            <button class="btn btn-outline" type="button" data-feed-page-action="prev" data-feed-round-id="${round.id}" ${currentPage <= 1 ? "disabled" : ""}>Anterior</button>
                            <span>Pagina ${currentPage} de ${totalPages}</span>
                            <button class="btn btn-outline" type="button" data-feed-page-action="next" data-feed-round-id="${round.id}" ${currentPage >= totalPages ? "disabled" : ""}>Proxima</button>
                        </div>
                      `
                    : "";
                return `
                <section class="round-carousel" data-round-id="${round.id}">
                    <div class="row-between">
                        <h3>Rodada - ${escapeHtml(formatRoundDateTime(round.created_at))} - ${escapeHtml(round.status)}</h3>
                        ${round.status === "closed" ? `<button class="btn btn-outline" data-open-naval-plan="${round.id}" type="button">Plano Naval</button>` : ""}
                    </div>
                    <p>Criador: ${userLinkHtml({ nickname: round.creator_nickname, username: round.creator_username }, round.creator_user_id)}</p>
                    <p class="round-participants-mini">Participantes: ${(round.participants || []).map((item) => userLinkHtml(item, item.id)).join(" | ") || "sem participantes"}</p>
                    <div class="carousel-track">
                        ${pageRecommendations.map((rec) => recommendationCardTemplate(rec, { showGradeOverlay: true, showInlineGrade: true })).join("")}
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
}

function updateHomeRoundStatus(activeRound) {
    const textEl = byId("activeRoundText");
    const newBtn = byId("newRoundBtn");

    if (!activeRound) {
        if (textEl) textEl.textContent = "Nenhuma rodada ativa. Crie uma nova rodada para comecar.";
        if (newBtn) {
            newBtn.disabled = false;
            newBtn.textContent = "Nova Rodada";
            newBtn.classList.remove("btn-success");
        }
        return;
    }

    const creatorName = displayName({
        nickname: activeRound.creator_nickname,
        username: activeRound.creator_username
    });

    if (activeRound.status === "draft") {
        if (activeRound.isCreator) {
            textEl.textContent = `Sua rodada de ${formatRoundDateTime(activeRound.created_at)} esta em preparacao.`;
            newBtn.disabled = false;
            newBtn.textContent = "Gerenciar Rodada";
            newBtn.classList.add("btn-success");
        } else {
            textEl.textContent = `Espectar Nova Rodada (${creatorName})`;
            newBtn.disabled = false;
            newBtn.textContent = "Ver Rodada em Andamento";
            newBtn.classList.add("btn-success");
        }
    } else if (activeRound.status === "reveal") {
        textEl.textContent = `Espectar Nova Rodada (${creatorName}) - fase de revelacao.`;
        newBtn.disabled = false;
        newBtn.textContent = activeRound.isCreator ? "Gerenciar Rodada" : "Ver Rodada em Andamento";
        newBtn.classList.add("btn-success");
    } else {
        textEl.textContent = `Rodada de ${formatRoundDateTime(activeRound.created_at)} em sessao de indicacoes.`;
        newBtn.disabled = false;
        newBtn.textContent = activeRound.isCreator ? "Gerenciar Rodada" : "Ver Rodada em Andamento";
        newBtn.classList.add("btn-success");
    }

}

async function refreshHomeActive() {
    const active = await sendJson("/api/rounds/active");
    homeActiveRound = active.activeRound;
    updateHomeRoundStatus(homeActiveRound);
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

    byId("refreshFeedBtn")?.addEventListener("click", async () => {
        try {
            await refreshHomeFeed();
            setFeedback("homeFeedback", "Feed atualizado.", "ok");
        } catch (error) {
            setFeedback("homeFeedback", error.message, "error");
        }
    });

    byId("newRoundBtn")?.addEventListener("click", async () => {
        try {
            if (homeActiveRound) {
                window.location.href = `/round.html?roundId=${homeActiveRound.id}`;
                return;
            }
            const created = await sendJson("/api/rounds/new", "POST", {});
            homeActiveRound = created.round;
            updateHomeRoundStatus(homeActiveRound);
            setFeedback("homeFeedback", "Nova rodada criada. Voce ja pode abrir e gerenciar.", "ok");
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

        const btn = event.target.closest("button[data-open-naval-plan]");
        if (!btn) return;
        const roundId = Number(btn.dataset.openNavalPlan);
        const round = homeRoundsMap.get(roundId);
        if (!round) return;
        byId("navalModalTitle").textContent = `Plano Naval - Rodada ${formatRoundDateTime(round.created_at)}`;
        renderNavalChartForHome(round);
        byId("navalModal")?.classList.remove("hidden");
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

    if (homeActivePollTimer) clearInterval(homeActivePollTimer);
    homeActivePollTimer = setInterval(async () => {
        try {
            await refreshHomeActive();
        } catch {
            // polling silencioso
        }
    }, 1700);

}

let currentRound = null;
let roundUsers = [];
let roundPollTimer = null;
let roundRecommendationsStructureSignature = "";
let roundLastPhase = "";

function renderParticipantList(round) {
    const list = byId("participantList");
    if (!list) return;

    list.innerHTML = (round.participants || [])
        .map((user) => {
            const removeButton =
                round.isCreator && round.phase === "draft" && user.id !== round.creator_user_id
                    ? `<button class="btn btn-outline" data-remove-user="${user.id}" type="button">Remover</button>`
                    : "";
            return `
                <div class="search-item">
                    <div class="search-item-main">
                        <img class="avatar-mini" src="${escapeHtml(user.avatar_url || baseAvatar)}" alt="avatar">
                        <div>
                            <strong>${escapeHtml(displayName(user))}</strong>
                            <div>@${escapeHtml(user.username)}</div>
                        </div>
                    </div>
                    ${removeButton}
                </div>
            `;
        })
        .join("");
}

function renderRoundRecommendations(round) {
    const container = byId("roundRecommendations");
    if (!container) return;
    const recommendations = round.recommendations || [];
    const structureSignature = recommendations
        .map((rec) => `${rec.id}:${rec.updated_at || 0}:${rec.rating_updated_at || 0}`)
        .join("|");

    if (!recommendations.length) {
        container.innerHTML = "<p>Ainda nao ha indicacoes enviadas nesta rodada.</p>";
        recommendationCommentSignatureCaches.round.clear();
        clearStaleCommentSignatures("round", []);
        roundRecommendationsStructureSignature = structureSignature;
        return;
    }

    if (structureSignature !== roundRecommendationsStructureSignature) {
        container.innerHTML = recommendations.map((rec) => recommendationCardTemplate(rec, { showGradeOverlay: false })).join("");
        recommendationCommentSignatureCaches.round.clear();
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
        const projectedRight = pointRect.right + stackWidth + 72;
        if (projectedRight > chartRect.right) {
            point.classList.add("flip-stack");
        }
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

function renderNavalChart(round) {
    const chart = byId("navalChart");
    if (!chart) return;

    const rated = (round.recommendations || []).filter((rec) => rec.rating_letter && rec.interest_score);
    if (!rated.length) {
        chart.innerHTML = "<p style='padding:12px;color:#9fb3e0;'>Ainda nao ha notas nesta rodada.</p>";
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
            const left = ((x - 1) / 9) * 100;
            const topPos = ((10 - y) / 9) * 100;
            const stack = list
                .map(
                    (rec) => `
                        <div class="naval-stack-item">
                            <img src="${escapeHtml(rec.game_cover_url || baseAvatar)}" alt="${escapeHtml(rec.game_name)}">
                            <div>${escapeHtml(rec.game_name)}</div>
                        </div>
                    `
                )
                .join("");

            return `
                <div class="naval-point" style="left:${left}%;top:${topPos}%;">
                    <img src="${escapeHtml(top.game_cover_url || baseAvatar)}" alt="${escapeHtml(top.game_name)}">
                    ${list.length > 1 ? `<span class="naval-count">${list.length}</span>` : ""}
                    ${stack ? `<div class="naval-stack">${stack}</div>` : ""}
                </div>
            `;
        })
        .join("");

    chart.innerHTML = pointsHtml;
    adjustNavalStacks(chart);
}

function renderRevealList(round) {
    const listEl = byId("revealList");
    if (!listEl) return;
    const assignments = round.assignments || [];
    if (!assignments.length) {
        listEl.innerHTML = "<p>O sorteio ainda nao foi gerado.</p>";
        return;
    }

    listEl.innerHTML = assignments
        .map((item) => {
            const giver = displayName({ nickname: item.giver_nickname, username: item.giver_username });
            const receiver = item.revealed
                ? displayName({ nickname: item.receiver_nickname, username: item.receiver_username })
                : "Oculto";
            const revealBtn = round.isCreator && !item.revealed
                ? `<button class="btn btn-outline" data-reveal-giver="${item.giver_user_id}" type="button">Mostrar sorteado</button>`
                : "";
            return `
                <div class="search-item">
                    <div><strong>${escapeHtml(giver)}</strong> -> <strong>${escapeHtml(receiver)}</strong></div>
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
              ? "Sorteio concluido. Revele os pareamentos."
              : round.phase === "indication"
                ? "Sessao de indicacoes aberta."
                : round.phase === "rating"
                  ? "Sessao de notas navais aberta."
              : "Rodada encerrada.";

    renderRoundRecommendations(round);

    if (round.phase === "draft") {
        if (round.isCreator) {
            byId("draftCreatorSection")?.classList.remove("hidden");
            renderParticipantList(round);
        } else {
            byId("draftSpectatorSection")?.classList.remove("hidden");
            const creatorName = displayName({
                nickname: round.creator_nickname,
                username: round.creator_username
            });
            byId("spectatorDraftText").textContent =
                `Espectar Nova Rodada (${creatorName}). Aguarde o sorteio ser finalizado.`;
        }
        return;
    }

    if (round.phase === "reveal") {
        byId("revealSection")?.classList.remove("hidden");
        renderRevealList(round);
        const tools = byId("startIndicationTools");
        if (round.isCreator) {
            tools?.classList.remove("hidden");
            const input = byId("ratingStartsAtInput");
            if (input && !input.value) {
                const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
                input.value = future.toISOString().slice(0, 16);
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
        if (round.isCreator) {
            if (round.phase === "closed") {
                closeBtn?.classList.add("hidden");
                finalizeBtn?.classList.add("hidden");
            } else if (round.phase === "rating") {
                closeBtn?.classList.add("hidden");
                finalizeBtn?.classList.remove("hidden");
            } else {
                closeBtn?.classList.remove("hidden");
                finalizeBtn?.classList.add("hidden");
            }
        } else {
            closeBtn?.classList.add("hidden");
            finalizeBtn?.classList.add("hidden");
        }

        const canIndicate = round.phase === "indication";
        if (round.myAssignment) {
            const target = displayName({
                nickname: round.myAssignment.receiver_nickname,
                username: round.myAssignment.receiver_username
            });
            byId("assignmentText").textContent = canIndicate
                ? `Sua indicacao desta rodada vai para: ${target}`
                : `Indicacoes encerradas. Voce indicou para: ${target}`;
            if (canIndicate) byId("recommendationForm")?.classList.remove("hidden");
            else byId("recommendationForm")?.classList.add("hidden");

            if (canIndicate && round.myRecommendation) {
                const form = byId("recommendationForm");
                form.elements.gameName.value = round.myRecommendation.game_name || "";
                form.elements.gameDescription.value = round.myRecommendation.game_description || "";
                form.elements.reason.value = round.myRecommendation.reason || "";
                byId("coverUrlInput").value = round.myRecommendation.game_cover_url || "";
                const preview = byId("coverPreview");
                if (round.myRecommendation.game_cover_url && preview) {
                    preview.src = round.myRecommendation.game_cover_url;
                    preview.classList.remove("hidden");
                }
                const submitBtn = form.querySelector("button[type='submit']");
                if (submitBtn) submitBtn.textContent = "Atualizar Indicacao";
            } else if (canIndicate) {
                const form = byId("recommendationForm");
                const submitBtn = form?.querySelector("button[type='submit']");
                if (submitBtn) submitBtn.textContent = "Salvar Indicacao";
            }
        } else {
            byId("assignmentText").textContent = "Voce esta espectando esta rodada.";
            byId("recommendationForm")?.classList.add("hidden");
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
                ratingText.textContent = "A sessao de notas foi liberada. Avalie os jogos que voce recebeu.";
                ratingForm?.classList.remove("hidden");
                ratingSelect.innerHTML = items
                    .map((rec) => `<option value="${rec.id}">${escapeHtml(rec.game_name)} (de ${escapeHtml(displayName({ nickname: rec.giver_nickname, username: rec.giver_username }))})</option>`)
                    .join("");
            } else {
                ratingText.textContent = "Voce nao recebeu jogos para avaliar nesta rodada.";
                ratingForm?.classList.add("hidden");
            }
        } else {
            const dateText = round.rating_starts_at
                ? new Date(round.rating_starts_at * 1000).toLocaleString("pt-BR")
                : "data nao definida";
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

    if (!currentRound || !currentRound.isCreator || currentRound.phase !== "draft") {
        container.innerHTML = "";
        return;
    }

    const existingIds = new Set((currentRound.participants || []).map((item) => item.id));
    const filtered = roundUsers.filter((user) => !existingIds.has(user.id));
    if (!filtered.length) {
        container.innerHTML = "<p>Nenhum usuario disponivel para adicionar.</p>";
        return;
    }

    container.innerHTML = filtered
        .map(
            (user) => `
                <div class="search-item">
                    <div class="search-item-main">
                        <img class="avatar-mini" src="${escapeHtml(user.avatar_url || baseAvatar)}" alt="avatar">
                        <div>
                            <strong>${escapeHtml(displayName(user))}</strong>
                            <div>@${escapeHtml(user.username)}</div>
                        </div>
                    </div>
                    <button class="btn" data-add-user="${user.id}" type="button">Adicionar</button>
                </div>
            `
        )
        .join("");
}

async function refreshRoundData(forceRoundId) {
    let roundId = forceRoundId || Number(getQueryParam("roundId") || 0);

    if (!roundId) {
        const active = await sendJson("/api/rounds/active");
        roundId = active.activeRound ? active.activeRound.id : 0;
    }

    if (!roundId) {
        currentRound = null;
        roundRecommendationsStructureSignature = "";
        recommendationCommentSignatureCaches.round.clear();
        roundLastPhase = "";
        byId("roundHeading").textContent = "Sem rodada ativa";
        byId("roundStatusText").textContent = "Crie uma nova rodada na pagina inicial.";
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
    }
    renderRoundState(currentRound);
    if (previousPhase && previousPhase !== "closed" && currentRound.phase === "closed") {
        setTimeout(() => {
            window.location.href = "/";
        }, 450);
        return;
    }
    roundLastPhase = currentRound.phase;
    if (currentRound.isCreator && currentRound.phase === "draft") {
        await loadUsersForRound(byId("participantSearch")?.value || "");
        renderUserSearchResults();
    }
}
let steamSuggestTimer = null;

function renderSteamResults(items) {
    const resultsBox = byId("steamResults");
    if (!resultsBox) return;
    if (!items.length) {
        resultsBox.innerHTML = "";
        return;
    }
    resultsBox.innerHTML = items
        .map(
            (item) => `
                <div class="search-item steam-pick-item" data-steam-pick='${JSON.stringify({
                    appId: item.appId,
                    name: item.name,
                    cover: item.libraryImage || item.largeCapsule || item.tinyImage,
                    description: item.description || ""
                }).replaceAll("'", "&#39;")}'>
                    <div class="search-item-main">
                        <img class="steam-result-cover" src="${escapeHtml(item.libraryImage || item.largeCapsule || item.tinyImage || baseAvatar)}" alt="capa">
                        <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <div>AppID: ${escapeHtml(item.appId)}</div>
                        </div>
                    </div>
                </div>
            `
        )
        .join("");
}

async function requestSteamSuggestions(term) {
    const trimmed = (term || "").trim();
    if (trimmed.length < 2) {
        byId("steamResults").innerHTML = "";
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
        if (!currentRound || !currentRound.isCreator || currentRound.phase !== "draft") return;
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

    byId("drawBtn")?.addEventListener("click", async () => {
        if (!currentRound) return;
        try {
            const result = await sendJson(`/api/rounds/${currentRound.id}/draw`, "POST", {});
            currentRound = result.round;
            renderRoundState(currentRound);
            setFeedback("roundFeedback", result.message, "ok");
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

    byId("startIndicationBtn")?.addEventListener("click", async () => {
        if (!currentRound) return;
        try {
            const raw = byId("ratingStartsAtInput")?.value || "";
            const ts = Math.floor(new Date(raw).getTime() / 1000);
            const result = await sendJson(`/api/rounds/${currentRound.id}/start-indication`, "POST", {
                ratingStartsAt: ts
            });
            currentRound = result.round;
            renderRoundState(currentRound);
            setFeedback("roundFeedback", result.message, "ok");
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    });

    const closeCurrentRound = async () => {
        if (!currentRound) return;
        try {
            const result = await sendJson(`/api/rounds/${currentRound.id}/close`, "POST", {});
            setFeedback("roundFeedback", result.message, "ok");
            await refreshRoundData(currentRound.id);
        } catch (error) {
            setFeedback("roundFeedback", error.message, "error");
        }
    };

    byId("closeRoundBtn")?.addEventListener("click", closeCurrentRound);
    byId("finalizeRoundBtn")?.addEventListener("click", closeCurrentRound);

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
                // sugestao silenciosa
            }
        }, 240);
    });

    byId("steamResults")?.addEventListener("click", async (event) => {
        const itemEl = event.target.closest("[data-steam-pick]");
        if (!itemEl) return;
        const raw = itemEl.dataset.steamPick || "{}";
        const picked = JSON.parse(raw.replaceAll("&#39;", "'"));

        const form = byId("recommendationForm");
        form.elements.gameName.value = picked.name || "";
        form.elements.steamAppId.value = picked.appId || "";
        byId("coverUrlInput").value = picked.cover || "";
        form.elements.gameDescription.value = picked.description || "";
        const preview = byId("coverPreview");
        if (picked.cover && preview) {
            preview.src = picked.cover;
            preview.classList.remove("hidden");
        }
        byId("steamResults").innerHTML = "";
        byId("steamTerm").value = picked.name || "";
        if (!form.elements.gameDescription.value.trim() && picked.appId) {
            try {
                const details = await sendJson(`/api/steam/app/${encodeURIComponent(picked.appId)}`);
                form.elements.gameDescription.value = details.item?.description || "";
            } catch {
                // descricao opcional em fallback
            }
        }
    });

    document.addEventListener("click", (event) => {
        const shell = event.target.closest(".steam-search-shell");
        if (!shell) byId("steamResults").innerHTML = "";
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
            setFeedback("roundFeedback", "Indicacao salva sem precisar atualizar a pagina.", "ok");
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

    if (roundPollTimer) clearInterval(roundPollTimer);
    roundPollTimer = setInterval(async () => {
        if (!currentRound) return;
        try {
            await refreshRoundData(currentRound.id);
        } catch {
            // polling silencioso
        }
    }, 1500);
}
async function init() {
    await handleLogoutButton();

    if (page === "login" || page === "register") showOAuthFeedbackFromQuery();

    if (page === "login") await handleLogin();
    if (page === "register") await handleRegister();
    if (page === "verify") await handleVerifyEmail();
    if (page === "forgot-password") await handleForgotPassword();
    if (page === "reset-password") await handleResetPassword();
    if (page === "profile") await loadProfile();
    if (page === "home") await handleHome();
    if (page === "round") await handleRoundPage();
}

init();
