const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const OWNER_EMAIL = "gabrielmicaelhenrique@gmail.com";
const BRAND_NAME = "Clube do Jogo";
const isProduction = process.env.NODE_ENV === "production";
const publicDir = path.join(__dirname, "public");
const ACHIEVEMENT_DEFINITIONS = [
    {
        key: "CGFerro",
        name: "CGFerro",
        requiredRounds: 1,
        imageUrl: "/uploads/trofeus/ferro.png",
        description: "participe de 1 rodada ate o fim"
    },
    {
        key: "CGBronze",
        name: "CGBronze",
        requiredRounds: 2,
        imageUrl: "/uploads/trofeus/bronze.png",
        description: "participe de 2 rodadas ate o fim"
    },
    {
        key: "CGPrata",
        name: "CGPrata",
        requiredRounds: 3,
        imageUrl: "/uploads/trofeus/prata.png",
        description: "participe de 3 rodadas ate o fim"
    },
    {
        key: "CGOuro",
        name: "CGOuro",
        requiredRounds: 4,
        imageUrl: "/uploads/trofeus/ouro.png",
        description: "participe de 4 rodadas ate o fim"
    },
    {
        key: "CGDiamante",
        name: "CGDiamante",
        requiredRounds: 5,
        imageUrl: "/uploads/trofeus/diamante.png",
        description: "participe de 5 rodadas ate o fim"
    },
    {
        key: "CGMaster",
        name: "CGMaster",
        requiredRounds: 6,
        imageUrl: "/uploads/trofeus/master.png",
        description: "participe de 6 rodadas ate o fim"
    },
    {
        key: "CGAcao",
        name: "CGAcao",
        criterion: "action",
        imageUrl: "/uploads/trofeus/acao.png",
        description: "indique um jogo de Acao"
    },
    {
        key: "CGAventura",
        name: "CGAventura",
        criterion: "adventure",
        imageUrl: "/uploads/trofeus/CGAventura.png",
        description: "indique um jogo de aventura"
    },
    {
        key: "CGDrama",
        name: "CGDrama",
        criterion: "drama",
        imageUrl: "/uploads/trofeus/CGDrama.png",
        description: "indique um jogo de drama"
    },
    {
        key: "CGNarrativo",
        name: "CGNarrativo",
        criterion: "narrative",
        imageUrl: "/uploads/trofeus/CGNarrativo.png",
        description: "indique um jogo narrativo"
    },
    {
        key: "CGRPG",
        name: "CGRPG",
        criterion: "rpg",
        imageUrl: "/uploads/trofeus/CGRPG.png",
        description: "indique um jogo de RPG"
    },
    {
        key: "CGPlataforma",
        name: "CGPlataforma",
        criterion: "platform",
        imageUrl: "/uploads/trofeus/CGPlataforma.png",
        description: "indique um jogo de plataforma"
    },
    {
        key: "CGCorrida",
        name: "CGCorrida",
        criterion: "racing",
        imageUrl: "/uploads/trofeus/CGCorrida.png",
        description: "indique um jogo de corrida"
    },
    {
        key: "CGMundoAberto",
        name: "CGMundoAberto",
        criterion: "open_world",
        imageUrl: "/uploads/trofeus/CGMundoAberto.png",
        description: "indique um jogo de mundo aberto"
    },
    {
        key: "CGTiro",
        name: "CGTiro",
        criterion: "shooter",
        imageUrl: "/uploads/trofeus/tiro.png",
        description: "indique um jogo de Tiro"
    },
    {
        key: "CGTerror",
        name: "CGTerror",
        criterion: "horror",
        imageUrl: "/uploads/trofeus/terror.png",
        description: "indique um jogo de Terror"
    },
    {
        key: "CGSouls",
        name: "CGSouls",
        criterion: "soulslike",
        imageUrl: "/uploads/trofeus/souls.png",
        description: "indique um jogo soulslike"
    },
    {
        key: "CGAwards",
        name: "CGAwards",
        criterion: "awards",
        imageUrl: "/uploads/trofeus/CGAwards.png",
        description: "indique um jogo do ano (The Game Awards)"
    },
    {
        key: "CGOld",
        name: "CGOld",
        criterion: "old",
        imageUrl: "/uploads/trofeus/CGOld.png",
        description: "indique um jogo antigo (<2010)"
    },
    {
        key: "CGNewba",
        name: "CGNewba",
        criterion: "first_rating",
        imageUrl: "/uploads/trofeus/CGNewba.png",
        description: "avalie uma indicação"
    }
];

const ACHIEVEMENT_KEYWORDS = {
    action: ["acao", "action", "hack and slash", "hack n slash", "beat em up", "brawler"],
    adventure: ["aventura", "adventure"],
    drama: ["drama", "dramatico", "dramatic", "emocional", "emotional"],
    narrative: ["narrativo", "narrativa", "narrative", "story rich", "story-driven", "story driven"],
    rpg: ["rpg", "role playing", "role-playing", "jrpg", "arpg"],
    platform: [
        "plataforma",
        "jogo de plataforma",
        "platformer",
        "platforming",
        "platform adventure",
        "2d platformer",
        "3d platformer",
        "side scroller",
        "side-scroller",
        "sidescroller",
        "metroidvania"
    ],
    racing: ["corrida", "racing", "race", "automobilismo"],
    open_world: ["mundo aberto", "open world", "sandbox"],
    shooter: ["tiro", "shooter", "fps", "tps", "first person shooter", "third person shooter"],
    horror: ["terror", "horror", "survival horror"],
    soulslike: [
        "soulslike",
        "souls-like",
        "dark souls",
        "demon's souls",
        "demons souls",
        "bloodborne",
        "elden ring",
        "sekiro",
        "nioh",
        "lies of p"
    ],
    awards: ["goty", "game of the year", "the game awards", "jogo do ano"]
};

const TGA_GOTY_WINNERS_NORMALIZED = [
    "dragon age inquisition",
    "the witcher 3 wild hunt",
    "overwatch",
    "the legend of zelda breath of the wild",
    "god of war",
    "sekiro shadows die twice",
    "the last of us part ii",
    "it takes two",
    "elden ring",
    "baldur s gate 3",
    "astro bot"
];

const parseOrigin = (value) => {
    try {
        return new URL(String(value || "").trim()).origin;
    } catch {
        return null;
    }
};

const publicAppUrl = parseOrigin(process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "");

const envAllowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => parseOrigin(value))
    .filter(Boolean);

const allowedOrigins = new Set([
    parseOrigin(baseUrl),
    publicAppUrl,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://clubedojogo.app.br",
    "http://clubedojogo.app.br",
    ...envAllowedOrigins
].filter(Boolean));

function getRequestOrigin(req) {
    const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol;
    const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    if (!host) return null;
    return `${protocol}://${host}`;
}

function isNgrokOrigin(origin) {
    return /^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i.test(origin)
        || /^https:\/\/[a-z0-9-]+\.ngrok\.app$/i.test(origin);
}

function isAllowedOrigin(origin, req) {
    if (!origin) return true;
    const normalizedOrigin = parseOrigin(origin);
    if (!normalizedOrigin) return false;
    if (allowedOrigins.has(normalizedOrigin)) return true;
    if (isNgrokOrigin(normalizedOrigin)) return true;

    const requestOrigin = parseOrigin(getRequestOrigin(req));
    return Boolean(requestOrigin && normalizedOrigin === requestOrigin);
}

function getPublicBaseUrl(req) {
    const envBase = publicAppUrl;
    if (envBase) return envBase;

    const originHeader = req?.get ? req.get("origin") : "";
    const refererHeader = req?.get ? req.get("referer") : "";
    const refererOrigin = parseOrigin(refererHeader);
    const originFromHeader = parseOrigin(originHeader);
    if (originFromHeader && isAllowedOrigin(originFromHeader, req)) {
        return originFromHeader;
    }
    if (refererOrigin && isAllowedOrigin(refererOrigin, req)) {
        return refererOrigin;
    }

    const reqOrigin = parseOrigin(req ? getRequestOrigin(req) : "");
    if (reqOrigin) return reqOrigin;
    return parseOrigin(baseUrl) || `http://localhost:${port}`;
}

function getGoogleCallbackUrl(req) {
    const originHeader = req?.get ? req.get("origin") : "";
    const refererHeader = req?.get ? req.get("referer") : "";
    const refererOrigin = parseOrigin(refererHeader);
    const originFromHeader = parseOrigin(originHeader);
    if (originFromHeader && isAllowedOrigin(originFromHeader, req)) {
        return `${originFromHeader}/auth/google/callback`;
    }
    if (refererOrigin && isAllowedOrigin(refererOrigin, req)) {
        return `${refererOrigin}/auth/google/callback`;
    }

    const reqOrigin = parseOrigin(req ? getRequestOrigin(req) : "");
    if (reqOrigin) {
        return `${reqOrigin}/auth/google/callback`;
    }

    const configured = sanitizeText(process.env.GOOGLE_CALLBACK_URL, 260);
    if (configured) {
        try {
            return new URL(configured).toString();
        } catch {
            // fallback para localhost/base
        }
    }
    const fallbackBase = publicAppUrl || parseOrigin(baseUrl) || `http://localhost:${port}`;
    return `${fallbackBase}/auth/google/callback`;
}

const dbFilePath = path.join(__dirname, "database.sqlite");
const legacyDbFilePath = path.join(__dirname, "app.db");
const resolvedDbPath = fs.existsSync(dbFilePath) ? dbFilePath : legacyDbFilePath;
const db = new sqlite3.Database(resolvedDbPath);
const SQLiteStore = SQLiteStoreFactory(session);

const uploadRoot = path.join(__dirname, "uploads");
const avatarDir = path.join(uploadRoot, "avatars");
const coverDir = path.join(uploadRoot, "covers");
fs.mkdirSync(avatarDir, { recursive: true });
fs.mkdirSync(coverDir, { recursive: true });

const adminEventClients = new Map();
let adminEventClientSeq = 0;
const roundEventClients = new Map();
let roundEventClientSeq = 0;

function emitAdminChange(reason = "updated", payload = {}) {
    const data = JSON.stringify({
        reason: sanitizeText(reason, 80) || "updated",
        at: nowInSeconds(),
        ...payload
    });
    for (const [clientId, client] of adminEventClients.entries()) {
        try {
            client.res.write(`event: admin-change\ndata: ${data}\n\n`);
        } catch {
            try {
                client.res.end();
            } catch {
                // sem acao
            }
            adminEventClients.delete(clientId);
        }
    }
}

function emitRoundChange(reason = "updated", payload = {}) {
    const data = JSON.stringify({
        reason: sanitizeText(reason, 80) || "updated",
        at: nowInSeconds(),
        ...payload
    });
    for (const [clientId, client] of roundEventClients.entries()) {
        try {
            client.res.write(`event: round-change\ndata: ${data}\n\n`);
        } catch {
            try {
                client.res.end();
            } catch {
                // sem acao
            }
            roundEventClients.delete(clientId);
        }
    }
}

const publicHtmlRoutes = new Set([
    "/login.html",
    "/register.html",
    "/verify-email.html",
    "/forgot-password.html",
    "/reset-password.html"
]);
const redirectWhenAuthenticatedRoutes = new Set([
    "/login.html",
    "/register.html",
    "/verify-email.html",
    "/forgot-password.html"
]);

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) return reject(error);
            resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) return reject(error);
            resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) return reject(error);
            resolve(rows);
        });
    });
}

async function getRoundIdByRecommendationId(recommendationId) {
    const row = await dbGet(
        `SELECT round_id
         FROM recommendations
         WHERE id = ? LIMIT 1`,
        [Number(recommendationId) || 0]
    );
    const roundId = Number(row?.round_id || 0);
    return Number.isInteger(roundId) && roundId > 0 ? roundId : 0;
}

async function emitRoundChangeForRecommendation(reason, recommendationId, payload = {}) {
    const recommendationIdNum = Number(recommendationId) || 0;
    if (!recommendationIdNum) return;
    const roundId = await getRoundIdByRecommendationId(recommendationIdNum);
    if (!roundId) return;
    emitRoundChange(reason, {
        roundId,
        recommendationId: recommendationIdNum,
        ...payload
    });
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function nowInSeconds() {
    return Math.floor(Date.now() / 1000);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function sanitizeText(value, max = 200) {
    return String(value || "").trim().slice(0, max);
}

function normalizeMatchText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function containsKeyword(text, keyword) {
    const source = String(text || "");
    const needle = String(keyword || "");
    return Boolean(needle) && source.includes(needle);
}

function containsAnyKeyword(text, keywords) {
    return (keywords || []).some((keyword) => containsKeyword(text, keyword));
}

function parseYearFromText(value) {
    const matches = String(value || "").match(/\b(19\d{2}|20\d{2})\b/g) || [];
    for (const token of matches) {
        const year = Number(token);
        if (Number.isInteger(year) && year >= 1970 && year <= 2099) {
            return year;
        }
    }
    return 0;
}

function maskEmailForDisplay(email) {
    const clean = String(email || "").trim();
    if (!clean.includes("@")) return clean;
    const [localPart, domainPart] = clean.split("@");
    if (!localPart || !domainPart) return clean;
    if (localPart.length <= 2) {
        return `${localPart.slice(0, 1)}******@${domainPart}`;
    }
    const prefix = localPart.slice(0, 2);
    const suffix = localPart.length > 4 ? localPart.slice(-2) : localPart.slice(-1);
    return `${prefix}******${suffix}@${domainPart}`;
}

function isOwnerEmail(email) {
    return String(email || "").trim().toLowerCase() === OWNER_EMAIL.toLowerCase();
}

function createVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function createToken() {
    return crypto.randomBytes(32).toString("hex");
}

const steamCache = {
    loadedAt: 0,
    apps: []
};
const rawgApiKey = sanitizeText(process.env.RAWG_API_KEY || "", 160);
const rawgMetadataCache = new Map();

async function loadSteamAppList() {
    const cacheIsFresh = Date.now() - steamCache.loadedAt < 1000 * 60 * 60 * 6;
    if (cacheIsFresh && steamCache.apps.length) {
        return steamCache.apps;
    }

    const endpoints = [
        "https://api.steampowered.com/ISteamApps/GetAppList/v2/",
        "https://api.steampowered.com/ISteamApps/GetAppList/v0002/"
    ];
    let lastError = null;

    for (const endpoint of endpoints) {
        let timeout = null;
        try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), 4500);
            const response = await fetch(endpoint, { signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) {
                lastError = new Error(`Steam app list indisponivel em ${endpoint}`);
                continue;
            }
            const data = await response.json();
            const apps = (data?.applist?.apps || [])
                .filter((item) => item && item.appid && String(item.name || "").trim())
                .map((item) => ({
                    appId: Number(item.appid),
                    name: String(item.name).trim(),
                    nameLower: String(item.name).trim().toLowerCase()
                }));
            if (apps.length) {
                steamCache.apps = apps;
                steamCache.loadedAt = Date.now();
                return apps;
            }
        } catch (error) {
            lastError = error;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    throw lastError || new Error("Falha ao carregar lista global da Steam.");
}

function scoreSteamMatch(app, termLower, termTokens) {
    const name = app.nameLower;
    const appIdText = String(app.appId);

    if (appIdText === termLower) return 1000;
    if (appIdText.startsWith(termLower)) return 900;
    if (name === termLower) return 850;
    if (name.startsWith(termLower)) return 760;
    if (name.includes(termLower)) return 620;

    let score = 0;
    for (const token of termTokens) {
        if (!token) continue;
        if (name.startsWith(token)) score += 70;
        else if (name.includes(token)) score += 35;
    }
    return score;
}

async function searchSteamGames(term, limit = 5) {
    const cleaned = sanitizeText(term, 120).toLowerCase();
    if (cleaned.length < 2) return [];
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const numericOnly = /^\d+$/.test(cleaned);

    const normalizeItem = (appId, name) => ({
        appId: Number(appId),
        name: String(name || "").trim() || `App ${appId}`,
        tinyImage: "",
        largeCapsule: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
        libraryImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
        description: ""
    });

    const fetchSteamAppDetails = async (appId) => {
        try {
            const endpoint = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=portuguese&cc=br`;
            const response = await fetch(endpoint);
            if (!response.ok) return null;
            const payload = await response.json();
            const node = payload?.[String(appId)];
            if (!node?.success || !node?.data) return null;
            const data = node.data;
            return {
                description: sanitizeText(data.short_description || "", 600),
                headerImage: data.header_image || "",
                capsuleImage: data.capsule_image || ""
            };
        } catch {
            return null;
        }
    };

    const fallbackStoreSearch = async () => {
        const endpoint = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleaned)}&l=portuguese&cc=br`;
        const response = await fetch(endpoint);
        if (!response.ok) return [];
        const data = await response.json();
        return (data.items || [])
            .filter((item) => item && item.id)
            .slice(0, limit)
            .map((item) => ({
                ...normalizeItem(item.id, item.name),
                tinyImage: "",
                largeCapsule: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`,
                libraryImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900_2x.jpg`,
                description: ""
            }));
    };

    try {
        const apps = await loadSteamAppList();
        const scored = [];
        for (const app of apps) {
            const score = scoreSteamMatch(app, cleaned, tokens);
            if (score > 0) {
                scored.push({ app, score });
            }
        }

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.app.name.localeCompare(b.app.name);
        });

        let items = scored.slice(0, limit * 2).map((item) => normalizeItem(item.app.appId, item.app.name));
        if (!items.length) {
            items = await fallbackStoreSearch();
        } else {
            const detailRows = await Promise.all(
                items.map(async (item) => {
                    const details = await fetchSteamAppDetails(item.appId);
                    return {
                        ...item,
                        largeCapsule: details?.headerImage || item.largeCapsule,
                        libraryImage: item.libraryImage,
                        description: details?.description || ""
                    };
                })
            );
            items = detailRows.filter(Boolean).slice(0, limit);
            if (!items.length) items = await fallbackStoreSearch();
        }
        return items
            .filter((item) => item && (item.largeCapsule || item.libraryImage))
            .slice(0, limit);
    } catch (error) {
        console.warn("[steam-search fallback]", error.message);
        let items = await fallbackStoreSearch();

        if (!items.length && numericOnly) {
            items = [normalizeItem(Number(cleaned), `App ${cleaned}`)];
        }
        return items
            .filter((item) => item && (item.largeCapsule || item.libraryImage))
            .slice(0, limit);
    }
}

function parseSteamReleaseYear(releaseDateText) {
    const normalized = sanitizeText(releaseDateText, 120);
    if (!normalized) return 0;
    const year = parseYearFromText(normalized);
    return Number.isInteger(year) ? year : 0;
}

function collectSteamGenreLabels(data) {
    const genreRows = Array.isArray(data?.genres) ? data.genres : [];
    const categoryRows = Array.isArray(data?.categories) ? data.categories : [];
    const combined = [...genreRows, ...categoryRows]
        .map((row) => sanitizeText(row?.description || "", 80))
        .filter(Boolean);
    return [...new Set(combined)];
}

function mergeGenreLabels(...labelLists) {
    const byNormalized = new Map();
    for (const list of labelLists) {
        const labels = Array.isArray(list) ? list : [];
        for (const rawLabel of labels) {
            const cleaned = sanitizeText(rawLabel, 80);
            if (!cleaned) continue;
            const normalized = normalizeMatchText(cleaned);
            if (!normalized) continue;
            if (!byNormalized.has(normalized)) {
                byNormalized.set(normalized, cleaned);
            }
        }
    }
    return [...byNormalized.values()];
}

async function getSteamAppDetails(appId) {
    const numericAppId = Number(appId);
    if (!Number.isInteger(numericAppId) || numericAppId <= 0) return null;
    try {
        const endpoint = `https://store.steampowered.com/api/appdetails?appids=${numericAppId}&l=portuguese&cc=br`;
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const payload = await response.json();
        const node = payload?.[String(numericAppId)];
        if (!node?.success || !node?.data) return null;
        const data = node.data;
        const name = sanitizeText(data.name || `App ${numericAppId}`, 120);
        let description = sanitizeText(data.short_description || "", 600);
        let genres = collectSteamGenreLabels(data);
        let releaseYear = parseSteamReleaseYear(data?.release_date?.date || "");

        const rawgDetails = await getRawgGameDetailsByName(name);
        const rawgDescription = sanitizeText(rawgDetails?.description || "", 600);
        const rawgGenres = Array.isArray(rawgDetails?.genres)
            ? rawgDetails.genres.map((item) => sanitizeText(item, 80)).filter(Boolean)
            : [];

        if (rawgDescription && (!description || seemsMostlyEnglishText(description)) && seemsPortugueseText(rawgDescription)) {
            description = rawgDescription;
        }

        genres = mergeGenreLabels(genres, rawgGenres);

        if ((!releaseYear || releaseYear <= 0) && Number(rawgDetails?.releaseYear) > 0) {
            releaseYear = Number(rawgDetails.releaseYear);
        }

        return {
            appId: numericAppId,
            source: rawgDetails ? "steam+rawg" : "steam",
            name,
            description,
            headerImage: data.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${numericAppId}/header.jpg`,
            libraryImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${numericAppId}/library_600x900_2x.jpg`,
            genres,
            releaseYear: releaseYear > 0 ? releaseYear : null
        };
    } catch {
        return null;
    }
}

function stripHtmlTags(value) {
    return String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function scoreLanguageHints(text, dictionary) {
    const normalized = normalizeMatchText(text);
    if (!normalized) return 0;
    const words = normalized.split(" ").filter(Boolean);
    let score = 0;
    for (const word of words) {
        if (dictionary.has(word)) score += 1;
    }
    return score;
}

function seemsPortugueseText(text) {
    const source = String(text || "");
    if (!source.trim()) return false;
    const ptWords = new Set([
        "de", "do", "da", "dos", "das", "um", "uma", "para", "com", "sem",
        "sobre", "entre", "jogo", "jogador", "historia", "voce", "nao", "que"
    ]);
    const accents = /[áàâãéêíóôõúç]/i.test(source) ? 2 : 0;
    const pt = scoreLanguageHints(source, ptWords) + accents;
    return pt >= 3;
}

function seemsMostlyEnglishText(text) {
    const source = String(text || "");
    if (!source.trim()) return false;
    const enWords = new Set([
        "the", "and", "you", "your", "with", "for", "from", "into", "about",
        "game", "players", "story", "world", "discover", "fight", "build"
    ]);
    const ptWords = new Set([
        "de", "do", "da", "dos", "das", "um", "uma", "para", "com", "sem",
        "sobre", "entre", "jogo", "jogador", "historia", "voce", "nao", "que"
    ]);
    const en = scoreLanguageHints(source, enWords);
    const pt = scoreLanguageHints(source, ptWords) + (/[áàâãéêíóôõúç]/i.test(source) ? 2 : 0);
    return en >= 3 && en > pt;
}

function scoreGameNameMatch(candidateName, targetName) {
    const candidate = normalizeMatchText(candidateName || "");
    const target = normalizeMatchText(targetName || "");
    if (!candidate || !target) return 0;
    if (candidate === target) return 100;
    if (candidate.startsWith(target) || target.startsWith(candidate)) return 85;
    if (candidate.includes(target) || target.includes(candidate)) return 70;
    const tokens = target.split(" ").filter(Boolean);
    if (!tokens.length) return 0;
    let hits = 0;
    for (const token of tokens) {
        if (candidate.includes(token)) hits += 1;
    }
    return Math.round((hits / tokens.length) * 60);
}

async function getSteamAppDetailsByName(gameName) {
    const cleaned = sanitizeText(gameName, 120);
    if (cleaned.length < 2) return null;
    try {
        const endpoint = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleaned)}&l=portuguese&cc=br`;
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const payload = await response.json();
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (!items.length) return null;

        let bestAppId = 0;
        let bestScore = 0;
        for (const item of items.slice(0, 10)) {
            const appId = Number(item?.id || 0);
            const score = scoreGameNameMatch(item?.name || "", cleaned);
            if (appId > 0 && score > bestScore) {
                bestScore = score;
                bestAppId = appId;
            }
        }
        if (!bestAppId || bestScore < 45) return null;
        return getSteamAppDetails(bestAppId);
    } catch {
        return null;
    }
}

async function getRawgGameMetadataById(gameId) {
    const numericId = Number(gameId);
    if (!Number.isInteger(numericId) || numericId <= 0) return null;
    if (!rawgApiKey) return null;
    try {
        const endpoint = `https://api.rawg.io/api/games/${numericId}?key=${encodeURIComponent(rawgApiKey)}&lang=pt-br`;
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const payload = await response.json();
        const raw = payload?.description_raw || payload?.description || "";
        const genres = (Array.isArray(payload?.genres) ? payload.genres : [])
            .map((genre) => sanitizeText(genre?.name || "", 60))
            .filter(Boolean);
        const tags = (Array.isArray(payload?.tags) ? payload.tags : [])
            .map((tag) => sanitizeText(tag?.name || "", 60))
            .filter(Boolean);
        return {
            description: sanitizeText(stripHtmlTags(raw), 600),
            genres,
            tags,
            releaseYear: parseYearFromText(sanitizeText(payload?.released || "", 20)),
            image: sanitizeText(payload?.background_image || "", 400),
            name: sanitizeText(payload?.name || "", 120)
        };
    } catch {
        return null;
    }
}

async function getRawgGameDetailsByName(gameName) {
    if (!rawgApiKey) return null;
    const cleaned = sanitizeText(gameName, 120);
    if (cleaned.length < 2) return null;
    const cacheKey = normalizeMatchText(cleaned);
    const cached = rawgMetadataCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt) < 1000 * 60 * 60 * 12) {
        return cached.value;
    }
    try {
        const endpoint = `https://api.rawg.io/api/games?key=${encodeURIComponent(rawgApiKey)}&search=${encodeURIComponent(cleaned)}&page_size=8&search_precise=true`;
        const response = await fetch(endpoint);
        if (!response.ok) return null;
        const payload = await response.json();
        const rows = Array.isArray(payload?.results) ? payload.results : [];
        if (!rows.length) return null;

        let best = null;
        let bestScore = 0;
        for (const row of rows) {
            const score = scoreGameNameMatch(row?.name || "", cleaned);
            if (score > bestScore) {
                bestScore = score;
                best = row;
            }
        }
        if (!best || bestScore < 45) return null;

        const searchGenres = (Array.isArray(best.genres) ? best.genres : [])
            .map((genre) => sanitizeText(genre?.name || "", 60))
            .filter(Boolean);
        const searchTags = (Array.isArray(best.tags) ? best.tags : [])
            .map((tag) => sanitizeText(tag?.name || "", 60))
            .filter(Boolean);
        const expanded = await getRawgGameMetadataById(best.id);
        const releaseYear = Number(expanded?.releaseYear || 0) > 0
            ? Number(expanded.releaseYear)
            : parseYearFromText(sanitizeText(best.released || "", 20));
        const image = sanitizeText(expanded?.image || best.background_image || "", 400);
        let description = sanitizeText(expanded?.description || "", 600);
        if (!description) {
            description = sanitizeText(stripHtmlTags(best.description_raw || best.description || ""), 600);
        }
        const mergedGenres = mergeGenreLabels(
            searchGenres,
            searchTags,
            expanded?.genres || [],
            expanded?.tags || []
        );

        const details = {
            appId: null,
            source: "rawg",
            name: sanitizeText(expanded?.name || best.name || cleaned, 120),
            description,
            headerImage: image,
            libraryImage: image,
            genres: mergedGenres,
            releaseYear: releaseYear > 0 ? releaseYear : null
        };
        rawgMetadataCache.set(cacheKey, { value: details, cachedAt: Date.now() });
        return details;
    } catch (error) {
        console.warn("[rawg-lookup]", error?.message || error);
        return null;
    }
}

async function resolveManualGameMetadataByName(gameName) {
    const cleaned = sanitizeText(gameName, 120);
    if (cleaned.length < 2) return null;

    const [fromRawg, fromSteam] = await Promise.all([
        getRawgGameDetailsByName(cleaned),
        getSteamAppDetailsByName(cleaned)
    ]);
    if (!fromRawg && !fromSteam) return null;

    const steamName = sanitizeText(fromSteam?.name || "", 120);
    const rawgName = sanitizeText(fromRawg?.name || "", 120);
    const steamDescription = sanitizeText(fromSteam?.description || "", 600);
    const rawgDescription = sanitizeText(fromRawg?.description || "", 600);

    let description = steamDescription;
    if ((!description || seemsMostlyEnglishText(description)) && rawgDescription) {
        if (seemsPortugueseText(rawgDescription) || !description) {
            description = rawgDescription;
        }
    }
    if (!description) {
        description = rawgDescription || steamDescription;
    }

    const mergedGenres = mergeGenreLabels(fromSteam?.genres || [], fromRawg?.genres || []);
    const steamYear = Number(fromSteam?.releaseYear || 0);
    const rawgYear = Number(fromRawg?.releaseYear || 0);
    const releaseYear = steamYear > 0 ? steamYear : (rawgYear > 0 ? rawgYear : 0);

    return {
        appId: Number(fromSteam?.appId || 0) || null,
        source: fromSteam && fromRawg ? "steam+rawg" : (fromSteam ? "steam" : "rawg"),
        name: steamName || rawgName || cleaned,
        description,
        headerImage: sanitizeText(fromSteam?.headerImage || fromRawg?.headerImage || "", 400),
        libraryImage: sanitizeText(
            fromSteam?.libraryImage || fromSteam?.headerImage || fromRawg?.libraryImage || fromRawg?.headerImage || "",
            400
        ),
        genres: mergedGenres,
        releaseYear: releaseYear > 0 ? releaseYear : null
    };
}

function randomSecretHex() {
    return crypto.randomBytes(32).toString("hex");
}

function isAllowedRatingLetter(letter) {
    return /^[A-J]$/.test(letter);
}

function usernameFromText(value) {
    const normalized = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, "")
        .slice(0, 30);
    if (normalized.length >= 3) return normalized;
    return `user${Math.floor(100 + Math.random() * 900)}`;
}

async function generateAvailableUsername(seedText) {
    const base = usernameFromText(seedText);
    for (let i = 0; i < 200; i += 1) {
        const suffix = i === 0 ? "" : String(i);
        const candidate = `${base}${suffix}`.slice(0, 30);
        const exists = await dbGet("SELECT id FROM users WHERE username = ? LIMIT 1", [candidate]);
        if (!exists) return candidate;
    }
    return `user${Date.now().toString().slice(-8)}`;
}

function nicknameFromUsername(username) {
    return sanitizeText(username, 30) || "Jogador";
}

async function nicknameExists(nickname, excludeUserId = 0) {
    const clean = sanitizeText(nickname, 30);
    if (!clean) return false;
    const exists = await dbGet(
        `SELECT id FROM users
         WHERE LOWER(COALESCE(nickname, '')) = LOWER(?)
           AND id <> ?
         LIMIT 1`,
        [clean, Number(excludeUserId) || 0]
    );
    return Boolean(exists);
}

async function generateAvailableNickname(seedText, fallbackUsername) {
    const baseSeed = sanitizeText(seedText, 30) || nicknameFromUsername(fallbackUsername);
    const compactBase = sanitizeText(baseSeed.replace(/\s+/g, " "), 30) || "Jogador";

    for (let i = 0; i < 200; i += 1) {
        const suffix = i === 0 ? "" : ` ${i}`;
        const candidate = sanitizeText(`${compactBase}${suffix}`, 30);
        if (!candidate) continue;
        const inUsers = await nicknameExists(candidate);
        if (!inUsers) return candidate;
    }

    return sanitizeText(`${compactBase} ${Date.now().toString().slice(-4)}`, 30) || "Jogador";
}

function shuffleArray(values) {
    const arr = [...values];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function ensureColumn(tableName, columnDefinition) {
    try {
        await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    } catch (error) {
        if (!String(error.message || "").includes("duplicate column name")) {
            throw error;
        }
    }
}

function createUploader(targetDir, maxSizeBytes = 6 * 1024 * 1024) {
    const extByMime = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/pjpeg": ".jpg",
        "image/png": ".png",
        "image/x-png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
        "image/heic": ".heic",
        "image/heif": ".heif"
    };
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, targetDir),
        filename: (req, file, cb) => {
            const mimeType = String(file.mimetype || "").toLowerCase();
            const extFromName = path.extname(String(file.originalname || "")).toLowerCase();
            const extFromMime = extByMime[mimeType] || "";
            const ext = extFromMime || (/^\.[a-z0-9]{2,6}$/i.test(extFromName) ? extFromName : ".png");
            cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
        }
    });

    return multer({
        storage,
        limits: { fileSize: maxSizeBytes },
        fileFilter: (req, file, cb) => {
            if (!String(file.mimetype || "").startsWith("image/")) {
                return cb(new Error("Apenas arquivos de imagem sao permitidos."));
            }
            return cb(null, true);
        }
    });
}

const avatarUpload = createUploader(avatarDir, 12 * 1024 * 1024);
const coverUpload = createUploader(coverDir, 8 * 1024 * 1024);

async function initDb() {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email_verified INTEGER NOT NULL DEFAULT 1,
            phone TEXT,
            address TEXT,
            city TEXT,
            state TEXT,
            zipcode TEXT,
            created_at INTEGER NOT NULL
        )
    `);

    await ensureColumn("users", "nickname TEXT");
    await ensureColumn("users", "avatar_url TEXT");
    await ensureColumn("users", "phone TEXT");
    await ensureColumn("users", "blocked INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("users", "is_moderator INTEGER NOT NULL DEFAULT 0");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS pending_registrations (
            email TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            city TEXT,
            state TEXT,
            zipcode TEXT,
            code_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    await ensureColumn("pending_registrations", "nickname TEXT");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at INTEGER NOT NULL,
            started_at INTEGER,
            rating_starts_at INTEGER,
            closed_at INTEGER,
            FOREIGN KEY (creator_user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("rounds", "rating_starts_at INTEGER");
    await ensureColumn("rounds", "reopened_count INTEGER NOT NULL DEFAULT 0");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS round_participants (
            round_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (round_id, user_id),
            FOREIGN KEY (round_id) REFERENCES rounds(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS round_pair_exclusions (
            round_id INTEGER NOT NULL,
            giver_user_id INTEGER NOT NULL,
            receiver_user_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (round_id, giver_user_id, receiver_user_id),
            FOREIGN KEY (round_id) REFERENCES rounds(id),
            FOREIGN KEY (giver_user_id) REFERENCES users(id),
            FOREIGN KEY (receiver_user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS round_assignments (
            round_id INTEGER NOT NULL,
            giver_user_id INTEGER NOT NULL,
            receiver_user_id INTEGER NOT NULL,
            revealed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (round_id, giver_user_id),
            FOREIGN KEY (round_id) REFERENCES rounds(id),
            FOREIGN KEY (giver_user_id) REFERENCES users(id),
            FOREIGN KEY (receiver_user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("round_assignments", "revealed INTEGER NOT NULL DEFAULT 0");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS pair_history (
            giver_user_id INTEGER NOT NULL,
            receiver_user_id INTEGER NOT NULL,
            used_in_cycle INTEGER NOT NULL DEFAULT 0,
            total_count INTEGER NOT NULL DEFAULT 0,
            last_assigned_at INTEGER,
            PRIMARY KEY (giver_user_id, receiver_user_id),
            FOREIGN KEY (giver_user_id) REFERENCES users(id),
            FOREIGN KEY (receiver_user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            round_id INTEGER NOT NULL,
            giver_user_id INTEGER NOT NULL,
            receiver_user_id INTEGER NOT NULL,
            game_name TEXT NOT NULL,
            game_cover_url TEXT,
            game_description TEXT NOT NULL,
            reason TEXT,
            rating_letter TEXT NOT NULL,
            interest_score INTEGER NOT NULL,
            steam_app_id TEXT,
            game_genres TEXT,
            game_release_year INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (round_id, giver_user_id),
            FOREIGN KEY (round_id) REFERENCES rounds(id),
            FOREIGN KEY (giver_user_id) REFERENCES users(id),
            FOREIGN KEY (receiver_user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("recommendations", "game_genres TEXT");
    await ensureColumn("recommendations", "game_release_year INTEGER");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS recommendation_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recommendation_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            comment_text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER,
            parent_comment_id INTEGER,
            FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("recommendation_comments", "updated_at INTEGER");
    await ensureColumn("recommendation_comments", "parent_comment_id INTEGER");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS profile_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_user_id INTEGER NOT NULL,
            author_user_id INTEGER NOT NULL,
            comment_text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (profile_user_id) REFERENCES users(id),
            FOREIGN KEY (author_user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("profile_comments", "updated_at INTEGER");
    await ensureColumn("profile_comments", "parent_comment_id INTEGER");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS recommendation_comment_likes (
            comment_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (comment_id, user_id),
            FOREIGN KEY (comment_id) REFERENCES recommendation_comments(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS profile_comment_likes (
            comment_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (comment_id, user_id),
            FOREIGN KEY (comment_id) REFERENCES profile_comments(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS recommendation_ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recommendation_id INTEGER NOT NULL UNIQUE,
            rater_user_id INTEGER NOT NULL,
            rating_letter TEXT NOT NULL,
            interest_score INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
            FOREIGN KEY (rater_user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS user_achievements (
            user_id INTEGER NOT NULL,
            achievement_key TEXT NOT NULL,
            unlocked_at INTEGER NOT NULL,
            notified_at INTEGER,
            PRIMARY KEY (user_id, achievement_key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("user_achievements", "notified_at INTEGER");

    await dbRun(`
        CREATE TABLE IF NOT EXISTS user_achievement_gates (
            user_id INTEGER NOT NULL,
            achievement_key TEXT NOT NULL,
            gated_after INTEGER NOT NULL,
            PRIMARY KEY (user_id, achievement_key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            target_page TEXT NOT NULL,
            suggestion_text TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS admin_action_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_user_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result_message TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            decided_at INTEGER,
            decided_by_user_id INTEGER,
            FOREIGN KEY (requester_user_id) REFERENCES users(id),
            FOREIGN KEY (decided_by_user_id) REFERENCES users(id)
        )
    `);
    await ensureColumn("admin_action_requests", "action_type TEXT");
    await ensureColumn("admin_action_requests", "action_key TEXT");
    await ensureColumn("admin_action_requests", "token_hash TEXT");
    await ensureColumn("admin_action_requests", "payload_json TEXT");
    await ensureColumn("admin_action_requests", "status TEXT NOT NULL DEFAULT 'pending'");
    await ensureColumn("admin_action_requests", "result_message TEXT");
    await ensureColumn("admin_action_requests", "created_at INTEGER");
    await ensureColumn("admin_action_requests", "expires_at INTEGER");
    await ensureColumn("admin_action_requests", "decided_at INTEGER");
    await ensureColumn("admin_action_requests", "decided_by_user_id INTEGER");
}

function buildMailer() {
    const smtpEnabled = String(process.env.SMTP_ENABLED || "false") === "true";
    if (!smtpEnabled) {
        return null;
    }
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null;
    }
    const ignoreTlsErrors = String(process.env.SMTP_IGNORE_TLS_ERRORS || "false") === "true";
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false") === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        tls: {
            rejectUnauthorized: !ignoreTlsErrors
        }
    });
}

const mailer = buildMailer();
const hasRealGoogleClientId =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    process.env.GOOGLE_CLIENT_ID !== "seu-google-client-id";
const hasRealGoogleClientSecret =
    Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
    process.env.GOOGLE_CLIENT_SECRET !== "seu-google-client-secret";
const googleEnabled =
    String(process.env.GOOGLE_ENABLED || "false") === "true" &&
    hasRealGoogleClientId &&
    hasRealGoogleClientSecret;

if (googleEnabled) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL || `${(publicAppUrl || parseOrigin(baseUrl) || `http://localhost:${port}`)}/auth/google/callback`
            },
            (accessToken, refreshToken, profile, done) => done(null, profile)
        )
    );
}

function buildMailFrom() {
    if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
    const fallbackUser = sanitizeText(process.env.SMTP_USER || "", 120);
    if (fallbackUser) return `${BRAND_NAME} <${fallbackUser}>`;
    return `${BRAND_NAME} <no-reply@localhost>`;
}

function renderEmailShell({ title, intro, bodyHtml, ctaLabel, ctaUrl, outro }) {
    const cta = ctaLabel && ctaUrl
        ? `<p style="margin:18px 0 8px;">
               <a href="${ctaUrl}" style="display:inline-block;padding:10px 16px;background:#2f82ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">
                   ${ctaLabel}
               </a>
           </p>`
        : "";
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a1124;font-family:Arial,Helvetica,sans-serif;color:#eaf1ff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a1124;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#101b38;border:1px solid #223b68;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:18px 20px;background:linear-gradient(120deg,#173069,#0d1a3a);border-bottom:1px solid #2b4f8a;">
              <div style="font-size:20px;font-weight:800;letter-spacing:0.4px;color:#fff;">${BRAND_NAME}</div>
              <div style="font-size:12px;color:#b5c8f2;margin-top:2px;">Comunicacao oficial</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 20px;">
              <h1 style="margin:0 0 12px;font-size:21px;line-height:1.25;color:#fff;">${title}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#c5d5f7;">${intro}</p>
              <div style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#eaf1ff;">${bodyHtml}</div>
              ${cta}
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#9bb5e6;">${outro || "Se voce nao reconhece esta acao, ignore este email."}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 20px;border-top:1px solid #22385f;color:#8da5d5;font-size:12px;">
              Enviado por ${BRAND_NAME}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendEmail({ to, subject, text, html }) {
    const from = buildMailFrom();
    if (!mailer) {
        console.log("[email simulacao]", { to, from, subject, text });
        return;
    }
    try {
        await mailer.sendMail({
            from,
            to,
            subject,
            text,
            html
        });
    } catch (error) {
        console.error("[falha smtp]", error.message);
        throw new Error(
            "Falha no envio de email (SMTP). Verifique SMTP_HOST, SMTP_USER e SMTP_PASS."
        );
    }
}

async function sendVerificationEmail(email, code) {
    const html = renderEmailShell({
        title: "Confirmacao de email",
        intro: "Recebemos uma solicita??o para criar sua conta no Clube do Jogo.",
        bodyHtml: `<p style="margin:0;">Seu codigo de confirmacao:</p>
                   <p style="margin:10px 0 6px;font-size:28px;font-weight:800;letter-spacing:3px;color:#6fd7ff;">${code}</p>
                   <p style="margin:0;color:#b9ccf4;">Este codigo expira em 10 minutos.</p>`
    });
    await sendEmail({
        to: email,
        subject: `${BRAND_NAME} | Código de confirmação`,
        text: `${BRAND_NAME}\n\nSeu codigo de confirmacao e: ${code}\nValidade: 10 minutos.`,
        html
    });
}

async function sendPasswordResetEmail(email, token, linkBaseUrl) {
    const safeBase = parseOrigin(linkBaseUrl) || parseOrigin(baseUrl) || `http://localhost:${port}`;
    const link = `${safeBase}/reset-password.html?token=${encodeURIComponent(token)}`;
    const html = renderEmailShell({
        title: "Alteracao de senha",
        intro: "Recebemos um pedido para alterar a senha da sua conta.",
        bodyHtml: `<p style="margin:0;">Use o botao abaixo para continuar.</p>
                   <p style="margin:10px 0;color:#b9ccf4;">Se preferir, copie e cole o link no navegador:</p>
                   <p style="margin:0;word-break:break-all;"><a href="${link}" style="color:#7ed6ff;">${link}</a></p>`,
        ctaLabel: "Alterar senha",
        ctaUrl: link,
        outro: "Este link expira em 1 hora."
    });
    await sendEmail({
        to: email,
        subject: `${BRAND_NAME} | Link para troca de senha`,
        text: `${BRAND_NAME}\n\nUse este link para trocar sua senha:\n${link}\n\nValidade: 1 hora.`,
        html
    });
}

async function createPasswordResetForUser(userId, email, linkBaseUrl) {
    const token = createToken();
    const tokenHash = sha256(token);
    const expiresAt = nowInSeconds() + 60 * 60;

    await dbRun("UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0", [userId]);
    await dbRun(
        `INSERT INTO password_resets (user_id, token_hash, expires_at, used, created_at)
         VALUES (?, ?, ?, 0, ?)`,
        [userId, tokenHash, expiresAt, nowInSeconds()]
    );
    await sendPasswordResetEmail(email, token, linkBaseUrl);
}

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ message: "Nao autenticado." });
    }
    dbGet(
        "SELECT id, username, email, blocked, is_moderator FROM users WHERE id = ? LIMIT 1",
        [req.session.userId]
    )
        .then((user) => {
            if (!user) {
                req.session.destroy(() => {});
                return res.status(401).json({ message: "Sessão inválida." });
            }
            if (Number(user.blocked) === 1) {
                req.session.destroy(() => {});
                return res.status(403).json({ message: "Conta bloqueada. Contate o dono do site." });
            }
            req.currentUser = {
                id: user.id,
                username: user.username,
                email: user.email,
                isOwner: isOwnerEmail(user.email),
                isModerator: !isOwnerEmail(user.email) && Number(user.is_moderator) === 1
            };
            return next();
        })
        .catch((error) => {
            console.error(error);
            return res.status(500).json({ message: "Erro ao validar sessão." });
        });
}

function requireOwner(req, res, next) {
    if (!req.currentUser?.isOwner) {
        return res.status(403).json({ message: "Apenas o dono do site pode fazer isso." });
    }
    return next();
}

function requireAdminAccess(req, res, next) {
    if (req.currentUser?.isOwner || req.currentUser?.isModerator) {
        return next();
    }
    return res.status(403).json({ message: "Acesso permitido apenas para dono e moderadores." });
}

const ADMIN_ACTION_TTL_SECONDS = 60 * 60 * 24;

function buildRoleFlags(userLike) {
    const isOwner = isOwnerEmail(userLike?.email || "");
    const isModerator = !isOwner && Number(userLike?.is_moderator) === 1;
    return {
        isOwner,
        isModerator,
        role: isOwner ? "owner" : (isModerator ? "moderator" : "user")
    };
}

function parseJsonSafely(rawText, fallback = {}) {
    try {
        const parsed = JSON.parse(String(rawText || ""));
        if (parsed && typeof parsed === "object") return parsed;
    } catch {
        // sem acao
    }
    return fallback;
}

function actionStatusLabel(status) {
    if (status === "approved") return "Aprovada";
    if (status === "denied") return "Negada";
    if (status === "pending") return "Pendente";
    return "Processada";
}

function adminActionLabel(actionType, payload = {}) {
    if (actionType === "user_block") {
        return Number(payload?.blocked) === 1 ? "Bloquear conta" : "Desbloquear conta";
    }
    if (actionType === "user_delete") return "Excluir conta";
    if (actionType === "achievement_grant") return "Dar conquista";
    if (actionType === "achievement_revoke") return "Tirar conquista";
    if (actionType === "achievement_reset_all") return "Zerar conquistas";
    if (actionType === "round_close") return "Fechar/Reabrir rodada";
    if (actionType === "round_delete") return "Excluir rodada";
    if (actionType === "set_role") return "Alterar cargo";
    return "Acao administrativa";
}

function adminActionDetailLines(actionType, payload = {}) {
    const lines = [];
    const targetUserName = sanitizeText(payload?.targetUserName || "", 120);
    const targetUserId = Number(payload?.targetUserId || 0);
    const roundId = Number(payload?.roundId || 0);
    const achievementKey = sanitizeText(payload?.achievementKey || "", 40);
    const role = sanitizeText(payload?.role || "", 20);

    if (targetUserName) {
        lines.push(`Usuário alvo: ${targetUserName}`);
    } else if (targetUserId > 0) {
        lines.push(`Usuário alvo: #${targetUserId}`);
    }
    if (roundId > 0) {
        lines.push(`Rodada alvo: #${roundId}`);
    }
    if ((actionType === "achievement_grant" || actionType === "achievement_revoke") && achievementKey) {
        lines.push(`Conquista: ${achievementKey}`);
    }
    if (actionType === "set_role" && role) {
        lines.push(`Novo cargo: ${role === "moderator" ? "Moderador" : "Usuário"}`);
    }
    return lines;
}

async function pruneExpiredAdminActionRequests() {
    const now = nowInSeconds();
    await dbRun(
        `UPDATE admin_action_requests
         SET status = 'denied',
             result_message = COALESCE(result_message, 'Solicitacao expirada.'),
             decided_at = ?,
             decided_by_user_id = NULL
         WHERE status = 'pending'
           AND expires_at < ?`,
        [now, now]
    );
}

async function getPendingAdminActionForRequester(userId) {
    await pruneExpiredAdminActionRequests();
    return dbGet(
        `SELECT id
         FROM admin_action_requests
         WHERE requester_user_id = ?
           AND status = 'pending'
           AND expires_at >= ?
         ORDER BY id DESC
         LIMIT 1`,
        [userId, nowInSeconds()]
    );
}

async function createAdminActionRequest(requesterUserId, actionType, payload) {
    const pending = await getPendingAdminActionForRequester(requesterUserId);
    if (pending) {
        const error = new Error("H? uma solicita??o pendente. Aguarde o dono permitir ou negar.");
        error.statusCode = 409;
        throw error;
    }
    const now = nowInSeconds();
    const expiresAt = now + ADMIN_ACTION_TTL_SECONDS;
    const tokenHash = sha256(createToken());
    await dbRun(
        `INSERT INTO admin_action_requests
            (requester_user_id, action_type, action_key, payload_json, status, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [
            requesterUserId,
            actionType,
            actionType,
            JSON.stringify(payload || {}),
            tokenHash,
            now,
            expiresAt
        ]
    );
    emitAdminChange("admin_action_request_created", {
        requesterUserId: Number(requesterUserId) || 0,
        actionType: sanitizeText(actionType, 80)
    });
}

async function listUserRolesForClient() {
    const users = await dbAll(
        `SELECT id, email, is_moderator
         FROM users
         ORDER BY id ASC`
    );
    return users.map((user) => {
        const flags = buildRoleFlags(user);
        return {
            id: Number(user.id),
            role: flags.role,
            is_owner: flags.isOwner,
            is_moderator: flags.isModerator
        };
    });
}

async function getUserBasicById(userId) {
    return dbGet(
        `SELECT id, username, email, nickname, avatar_url
         FROM users
         WHERE id = ? LIMIT 1`,
        [userId]
    );
}

async function getActiveRound() {
    return dbGet(
        `SELECT id, creator_user_id, status, created_at, started_at, rating_starts_at, closed_at
         FROM rounds
         WHERE status IN ('draft', 'reveal', 'indication')
         ORDER BY id DESC
         LIMIT 1`
    );
}

async function getRoundParticipants(roundId) {
    return dbAll(
        `SELECT u.id, u.username, u.nickname, u.avatar_url
         FROM round_participants rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.round_id = ?
         ORDER BY COALESCE(u.nickname, u.username) COLLATE NOCASE ASC`,
        [roundId]
    );
}

async function getRoundParticipantsCompact(roundId) {
    return dbAll(
        `SELECT u.id, u.username, u.nickname
         FROM round_participants rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.round_id = ?
         ORDER BY COALESCE(u.nickname, u.username) COLLATE NOCASE ASC`,
        [roundId]
    );
}

function pairKey(giverUserId, receiverUserId) {
    return `${Number(giverUserId)}:${Number(receiverUserId)}`;
}

function pairIdsFromAny(item) {
    const giverUserId = Number(item?.giver_user_id ?? item?.giverUserId ?? 0);
    const receiverUserId = Number(item?.receiver_user_id ?? item?.receiverUserId ?? 0);
    return { giverUserId, receiverUserId };
}

function toBlockedPairsSet(blockedPairs = []) {
    const set = new Set();
    (Array.isArray(blockedPairs) ? blockedPairs : []).forEach((item) => {
        const { giverUserId, receiverUserId } = pairIdsFromAny(item);
        if (!Number.isInteger(giverUserId) || !Number.isInteger(receiverUserId)) return;
        if (giverUserId <= 0 || receiverUserId <= 0) return;
        if (giverUserId === receiverUserId) return;
        set.add(pairKey(giverUserId, receiverUserId));
    });
    return set;
}

function createBadRequestError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function validatePairRestrictions(participantIds, blockedPairs = []) {
    const uniqueIds = [...new Set((participantIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (uniqueIds.length < 2) return;

    const blockedPairsSet = toBlockedPairsSet(blockedPairs);
    const allowedMap = new Map();

    for (const giverId of uniqueIds) {
        const receivers = uniqueIds.filter(
            (id) => id !== giverId && !blockedPairsSet.has(pairKey(giverId, id))
        );
        if (!receivers.length) {
            throw createBadRequestError(
                "Cada participante precisa ter pelo menos 1 pessoa possível para receber sua indicação."
            );
        }
        allowedMap.set(giverId, receivers);
    }

    const assignmentMap = findDerangementAssignments(uniqueIds, allowedMap);
    if (!assignmentMap) {
        throw createBadRequestError(
            "Restricoes inconsistentes. Ajuste os bloqueios para permitir um sorteio valido para todos."
        );
    }
}

async function getRoundPairExclusions(roundId) {
    return dbAll(
        `SELECT giver_user_id, receiver_user_id
         FROM round_pair_exclusions
         WHERE round_id = ?`,
        [roundId]
    );
}

async function sanitizeAndSavePairExclusions(roundId, rawPairs) {
    const participants = await dbAll(
        "SELECT user_id FROM round_participants WHERE round_id = ?",
        [roundId]
    );
    const participantIds = participants
        .map((row) => Number(row.user_id))
        .filter((id) => Number.isInteger(id) && id > 0);
    const validUserIds = new Set(participantIds);
    const normalizedMap = new Map();

    (Array.isArray(rawPairs) ? rawPairs : []).forEach((item) => {
        const { giverUserId, receiverUserId } = pairIdsFromAny(item);
        if (!Number.isInteger(giverUserId) || !Number.isInteger(receiverUserId)) return;
        if (giverUserId <= 0 || receiverUserId <= 0) return;
        if (giverUserId === receiverUserId) return;
        if (!validUserIds.has(giverUserId) || !validUserIds.has(receiverUserId)) return;
        normalizedMap.set(pairKey(giverUserId, receiverUserId), {
            giverUserId,
            receiverUserId
        });
    });

    const normalizedPairs = [...normalizedMap.values()];
    validatePairRestrictions(participantIds, normalizedPairs);

    await dbRun("DELETE FROM round_pair_exclusions WHERE round_id = ?", [roundId]);
    for (const item of normalizedPairs) {
        await dbRun(
            `INSERT INTO round_pair_exclusions (round_id, giver_user_id, receiver_user_id, created_at)
             VALUES (?, ?, ?, ?)`,
            [roundId, item.giverUserId, item.receiverUserId, nowInSeconds()]
        );
    }

    return normalizedPairs;
}

async function cleanupRoundPairExclusions(roundId) {
    const participants = await dbAll(
        "SELECT user_id FROM round_participants WHERE round_id = ?",
        [roundId]
    );
    const ids = participants.map((row) => Number(row.user_id)).filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) {
        await dbRun("DELETE FROM round_pair_exclusions WHERE round_id = ?", [roundId]);
        return;
    }
    const placeholders = ids.map(() => "?").join(", ");
    await dbRun(
        `DELETE FROM round_pair_exclusions
         WHERE round_id = ?
           AND (giver_user_id NOT IN (${placeholders})
                OR receiver_user_id NOT IN (${placeholders})
                OR giver_user_id = receiver_user_id)`,
        [roundId, ...ids, ...ids]
    );
}

async function getRoundAssignments(roundId) {
    return dbAll(
        `SELECT ra.giver_user_id, ra.receiver_user_id, ra.revealed,
                g.username AS giver_username, g.nickname AS giver_nickname, g.avatar_url AS giver_avatar,
                r.username AS receiver_username, r.nickname AS receiver_nickname, r.avatar_url AS receiver_avatar
         FROM round_assignments ra
         JOIN users g ON g.id = ra.giver_user_id
         JOIN users r ON r.id = ra.receiver_user_id
         WHERE ra.round_id = ?`,
        [roundId]
    );
}

async function getRoundRecommendations(roundId, currentUserId = 0) {
    const viewerIdRaw = Number(currentUserId);
    const viewerId = Number.isInteger(viewerIdRaw) && viewerIdRaw > 0 ? viewerIdRaw : 0;
    const rows = await dbAll(
        `SELECT rec.id, rec.round_id, rec.giver_user_id, rec.receiver_user_id,
                rec.game_name, rec.game_cover_url, rec.game_description, rec.reason,
                rec.steam_app_id,
                rr.rating_letter, rr.interest_score, rr.updated_at AS rating_updated_at, rr.rater_user_id,
                rec.created_at, rec.updated_at,
                g.username AS giver_username, g.nickname AS giver_nickname, g.avatar_url AS giver_avatar,
                r.username AS receiver_username, r.nickname AS receiver_nickname, r.avatar_url AS receiver_avatar
         FROM recommendations rec
         JOIN users g ON g.id = rec.giver_user_id
         JOIN users r ON r.id = rec.receiver_user_id
         LEFT JOIN recommendation_ratings rr ON rr.recommendation_id = rec.id
         WHERE rec.round_id = ?
         ORDER BY rec.updated_at DESC`,
        [roundId]
    );

    if (!rows.length) return rows.map((row) => ({ ...row, comments: [] }));
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const comments = await dbAll(
        `SELECT c.id, c.recommendation_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                u.id AS user_id, u.username, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM recommendation_comment_likes l WHERE l.comment_id = c.id) AS likes_count,
                CASE
                    WHEN ? > 0 AND EXISTS (
                        SELECT 1
                        FROM recommendation_comment_likes l2
                        WHERE l2.comment_id = c.id
                          AND l2.user_id = ?
                    ) THEN 1
                    ELSE 0
                END AS liked_by_me
         FROM recommendation_comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.recommendation_id IN (${placeholders})
         ORDER BY c.created_at ASC`,
        [viewerId, viewerId, ...ids]
    );

    const commentsByRecommendation = new Map();
    comments.forEach((comment) => {
        if (!commentsByRecommendation.has(comment.recommendation_id)) {
            commentsByRecommendation.set(comment.recommendation_id, []);
        }
        commentsByRecommendation.get(comment.recommendation_id).push(comment);
    });

    return rows.map((row) => ({
        ...row,
        comments: commentsByRecommendation.get(row.id) || []
    }));
}

async function getUserProfileActivity(userId) {
    const given = await dbAll(
        `SELECT rec.id, rec.round_id, rec.game_name, rec.game_cover_url, rec.game_description, rec.reason,
                rec.created_at, rec.updated_at,
                rr.rating_letter, rr.interest_score, rr.updated_at AS rating_updated_at,
                recv.id AS receiver_id, recv.username AS receiver_username, recv.nickname AS receiver_nickname,
                g.username AS giver_username, g.nickname AS giver_nickname
         FROM recommendations rec
         JOIN users recv ON recv.id = rec.receiver_user_id
         JOIN users g ON g.id = rec.giver_user_id
         LEFT JOIN recommendation_ratings rr ON rr.recommendation_id = rec.id
         WHERE rec.giver_user_id = ?
         ORDER BY rec.updated_at DESC
         LIMIT 80`,
        [userId]
    );
    const received = await dbAll(
        `SELECT rec.id, rec.round_id, rec.game_name, rec.game_cover_url, rec.game_description, rec.reason,
                rec.created_at, rec.updated_at,
                rr.rating_letter, rr.interest_score, rr.updated_at AS rating_updated_at,
                giver.id AS giver_id, giver.username AS giver_username, giver.nickname AS giver_nickname
         FROM recommendations rec
         JOIN users giver ON giver.id = rec.giver_user_id
         LEFT JOIN recommendation_ratings rr ON rr.recommendation_id = rec.id
         WHERE rec.receiver_user_id = ?
         ORDER BY rec.updated_at DESC
         LIMIT 80`,
        [userId]
    );
    return { given, received };
}

async function countCompletedRoundsForUser(userId, gatedAfter = 0) {
    const gate = Number(gatedAfter || 0);
    const row = await dbGet(
        `SELECT COUNT(*) AS total
         FROM rounds r
         WHERE r.status = 'closed'
           AND COALESCE(r.reopened_count, 0) = 0
           AND COALESCE(r.closed_at, r.created_at, 0) > ?
           AND EXISTS (
                SELECT 1
                FROM recommendations rec
                WHERE rec.round_id = r.id
                  AND rec.giver_user_id = ?
                  AND COALESCE(rec.updated_at, rec.created_at, 0) > ?
           )
           AND EXISTS (
                SELECT 1
                FROM recommendations rec2
                JOIN recommendation_ratings rr ON rr.recommendation_id = rec2.id
                WHERE rec2.round_id = r.id
                  AND rec2.receiver_user_id = ?
                  AND rr.rater_user_id = ?
                  AND COALESCE(rr.updated_at, rr.created_at, 0) > ?
           )`,
        [gate, userId, gate, userId, userId, gate]
    );
    return Number(row?.total || 0);
}

async function hydrateRecommendationMetadataForAchievements(userId, gatedAfter = 0) {
    const gate = Number(gatedAfter || 0);
    const missing = await dbAll(
        `SELECT rec.id, rec.steam_app_id
         FROM recommendations rec
         JOIN rounds r ON r.id = rec.round_id
         WHERE rec.giver_user_id = ?
           AND (
                (r.status = 'closed'
                 AND COALESCE(r.reopened_count, 0) = 0
                 AND COALESCE(r.closed_at, r.created_at, 0) > ?)
                OR (
                    r.status <> 'closed'
                    AND COALESCE(rec.updated_at, rec.created_at, 0) > ?
                )
           )
           AND COALESCE(rec.updated_at, rec.created_at, 0) > ?
           AND COALESCE(rec.steam_app_id, '') <> ''
           AND (
                rec.game_release_year IS NULL
                OR rec.game_release_year <= 0
                OR COALESCE(rec.game_genres, '') = ''
                OR LENGTH(COALESCE(rec.game_genres, '')) = 320
           )
         ORDER BY rec.id DESC
         LIMIT 24`,
        [userId, gate, gate, gate]
    );
    for (const row of missing) {
        const appId = sanitizeText(row?.steam_app_id || "", 20);
        if (!appId) continue;
        const details = await getSteamAppDetails(appId);
        if (!details) continue;
        const genresText = sanitizeText((details.genres || []).join(", "), 2000);
        const releaseYear = Number(details.releaseYear || 0);
        await dbRun(
            `UPDATE recommendations
             SET game_genres = CASE
                                   WHEN COALESCE(?, '') <> '' THEN ?
                                   ELSE game_genres
                               END,
                 game_release_year = CASE
                                         WHEN ? > 0 THEN ?
                                         ELSE game_release_year
                                     END
             WHERE id = ?`,
            [genresText, genresText, releaseYear, releaseYear, row.id]
        );
    }
}

function detectRecommendationSignals(recommendation) {
    const name = normalizeMatchText(recommendation?.game_name || "");
    const description = normalizeMatchText(recommendation?.game_description || "");
    const reason = normalizeMatchText(recommendation?.reason || "");
    const genres = normalizeMatchText(recommendation?.game_genres || "");
    const allText = `${name} ${description} ${reason} ${genres}`.replace(/\s+/g, " ").trim();
    const releaseYear = Number(recommendation?.game_release_year || 0);
    const fallbackYear = parseYearFromText(allText);
    const effectiveYear = releaseYear > 0 ? releaseYear : fallbackYear;

    const gotyByName = name.length >= 3 && TGA_GOTY_WINNERS_NORMALIZED.some((winnerName) =>
        name.includes(winnerName) || winnerName.includes(name)
    );
    const awardsByKeyword = containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.awards);
    const platformSpecificKeywords = [
        "platformer",
        "platforming",
        "platform adventure",
        "metroidvania",
        "2d platformer",
        "3d platformer",
        "side scroller",
        "side-scroller",
        "jogo de plataforma"
    ];
    const hasPlatformSpecific = containsAnyKeyword(allText, platformSpecificKeywords);
    const hasPlatformGeneric = containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.platform);
    const hasRacing = containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.racing);
    const platformDetected = hasPlatformSpecific || (hasPlatformGeneric && !hasRacing);

    return {
        action: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.action),
        adventure: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.adventure),
        drama: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.drama),
        narrative: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.narrative),
        rpg: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.rpg),
        platform: platformDetected,
        racing: hasRacing,
        open_world: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.open_world),
        shooter: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.shooter),
        horror: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.horror),
        soulslike: containsAnyKeyword(allText, ACHIEVEMENT_KEYWORDS.soulslike),
        awards: awardsByKeyword || gotyByName,
        old: effectiveYear > 0 && effectiveYear < 2010
    };
}

async function getRecommendationAchievementSignals(userId, gatedAfter = 0) {
    const gate = Number(gatedAfter || 0);
    await hydrateRecommendationMetadataForAchievements(userId, gate);
    const rows = await dbAll(
        `SELECT rec.game_name, rec.game_description, rec.reason, rec.game_genres, rec.game_release_year
         FROM recommendations rec
         JOIN rounds r ON r.id = rec.round_id
         WHERE rec.giver_user_id = ?
           AND (
                (COALESCE(r.reopened_count, 0) = 0
                 AND COALESCE(r.closed_at, r.created_at, 0) > ?)
                OR (
                    r.status <> 'closed'
                    AND COALESCE(rec.updated_at, rec.created_at, 0) > ?
                )
           )
           AND COALESCE(rec.updated_at, rec.created_at, 0) > ?`,
        [userId, gate, gate, gate]
    );

    const aggregate = {
        action: false,
        adventure: false,
        drama: false,
        narrative: false,
        rpg: false,
        platform: false,
        racing: false,
        open_world: false,
        shooter: false,
        horror: false,
        soulslike: false,
        awards: false,
        old: false
    };

    for (const row of rows) {
        const detected = detectRecommendationSignals(row);
        aggregate.action = aggregate.action || detected.action;
        aggregate.adventure = aggregate.adventure || detected.adventure;
        aggregate.drama = aggregate.drama || detected.drama;
        aggregate.narrative = aggregate.narrative || detected.narrative;
        aggregate.rpg = aggregate.rpg || detected.rpg;
        aggregate.platform = aggregate.platform || detected.platform;
        aggregate.racing = aggregate.racing || detected.racing;
        aggregate.open_world = aggregate.open_world || detected.open_world;
        aggregate.shooter = aggregate.shooter || detected.shooter;
        aggregate.horror = aggregate.horror || detected.horror;
        aggregate.soulslike = aggregate.soulslike || detected.soulslike;
        aggregate.awards = aggregate.awards || detected.awards;
        aggregate.old = aggregate.old || detected.old;
        if (Object.values(aggregate).every(Boolean)) break;
    }
    return aggregate;
}

async function countRatedRecommendationsForUser(userId, gatedAfter = 0) {
    const gate = Number(gatedAfter || 0);
    const row = await dbGet(
        `SELECT COUNT(*) AS total
         FROM recommendation_ratings rr
         JOIN recommendations rec ON rec.id = rr.recommendation_id
         JOIN rounds r ON r.id = rec.round_id
         WHERE rr.rater_user_id = ?
           AND rec.receiver_user_id = ?
           AND COALESCE(rr.updated_at, rr.created_at, 0) > ?
           AND (
                (r.status = 'closed'
                 AND COALESCE(r.reopened_count, 0) = 0
                 AND COALESCE(r.closed_at, r.created_at, 0) > ?)
                OR r.status <> 'closed'
           )`,
        [userId, userId, gate, gate]
    );
    return Number(row?.total || 0);
}

function shouldUnlockAchievement(definition, completedRounds, recommendationSignals, ratedRecommendations) {
    if (Number.isInteger(definition.requiredRounds) && definition.requiredRounds > 0) {
        return completedRounds >= definition.requiredRounds;
    }
    if (definition.criterion === "action") return Boolean(recommendationSignals.action);
    if (definition.criterion === "adventure") return Boolean(recommendationSignals.adventure);
    if (definition.criterion === "drama") return Boolean(recommendationSignals.drama);
    if (definition.criterion === "narrative") return Boolean(recommendationSignals.narrative);
    if (definition.criterion === "rpg") return Boolean(recommendationSignals.rpg);
    if (definition.criterion === "platform") return Boolean(recommendationSignals.platform);
    if (definition.criterion === "racing") return Boolean(recommendationSignals.racing);
    if (definition.criterion === "open_world") return Boolean(recommendationSignals.open_world);
    if (definition.criterion === "shooter") return Boolean(recommendationSignals.shooter);
    if (definition.criterion === "horror") return Boolean(recommendationSignals.horror);
    if (definition.criterion === "soulslike") return Boolean(recommendationSignals.soulslike);
    if (definition.criterion === "awards") return Boolean(recommendationSignals.awards);
    if (definition.criterion === "old") return Boolean(recommendationSignals.old);
    if (definition.criterion === "first_rating") return Number(ratedRecommendations || 0) >= 1;
    return false;
}

function buildAchievementsPayload(completedRounds, achievementRows) {
    const rowMap = new Map(
        (achievementRows || []).map((row) => [String(row.achievement_key), row])
    );
    const achievements = ACHIEVEMENT_DEFINITIONS.map((definition) => {
        const row = rowMap.get(definition.key);
        return {
            key: definition.key,
            name: definition.name || definition.key,
            requiredRounds: Number.isInteger(definition.requiredRounds) ? definition.requiredRounds : 0,
            description: definition.description,
            imageUrl: definition.imageUrl,
            unlocked: Boolean(row),
            unlockedAt: row?.unlocked_at || null
        };
    });
    const newlyUnlocked = achievements.filter((achievement) => {
        const row = rowMap.get(achievement.key);
        return Boolean(row) && !row.notified_at;
    });
    return {
        completedRounds,
        achievements,
        newlyUnlocked
    };
}

async function syncUserAchievements(userId, { markNewAsNotified = false } = {}) {
    const totalCompletedRounds = await countCompletedRoundsForUser(userId, 0);
    const gateRows = await dbAll(
        `SELECT achievement_key, gated_after
         FROM user_achievement_gates
         WHERE user_id = ?`,
        [userId]
    );
    const gateByKey = new Map(
        gateRows.map((row) => [String(row.achievement_key || ""), Number(row.gated_after || 0)])
    );
    const roundsByGate = new Map();
    const signalsByGate = new Map();
    const ratingsByGate = new Map();
    const getCompletedRoundsForGate = async (gate) => {
        if (!roundsByGate.has(gate)) {
            roundsByGate.set(gate, await countCompletedRoundsForUser(userId, gate));
        }
        return roundsByGate.get(gate);
    };
    const getSignalsForGate = async (gate) => {
        if (!signalsByGate.has(gate)) {
            signalsByGate.set(gate, await getRecommendationAchievementSignals(userId, gate));
        }
        return signalsByGate.get(gate);
    };
    const getRatingsForGate = async (gate) => {
        if (!ratingsByGate.has(gate)) {
            ratingsByGate.set(gate, await countRatedRecommendationsForUser(userId, gate));
        }
        return ratingsByGate.get(gate);
    };
    const now = nowInSeconds();
    const shouldBeUnlocked = [];
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
        const gate = Number(gateByKey.get(definition.key) || 0);
        const completedRounds = await getCompletedRoundsForGate(gate);
        const recommendationSignals = await getSignalsForGate(gate);
        const ratedRecommendations = await getRatingsForGate(gate);
        if (shouldUnlockAchievement(definition, completedRounds, recommendationSignals, ratedRecommendations)) {
            shouldBeUnlocked.push(definition.key);
        }
    }

    for (const achievementKey of shouldBeUnlocked) {
        await dbRun(
            `INSERT OR IGNORE INTO user_achievements (user_id, achievement_key, unlocked_at)
             VALUES (?, ?, ?)`,
            [userId, achievementKey, now]
        );
    }

    let rows = await dbAll(
        `SELECT achievement_key, unlocked_at, notified_at
         FROM user_achievements
         WHERE user_id = ?`,
        [userId]
    );
    let payload = buildAchievementsPayload(totalCompletedRounds, rows);

    if (markNewAsNotified && payload.newlyUnlocked.length) {
        const keys = payload.newlyUnlocked.map((item) => item.key);
        const placeholders = keys.map(() => "?").join(", ");
        await dbRun(
            `UPDATE user_achievements
             SET notified_at = ?
             WHERE user_id = ?
               AND achievement_key IN (${placeholders})
               AND notified_at IS NULL`,
            [now, userId, ...keys]
        );
        rows = await dbAll(
            `SELECT achievement_key, unlocked_at, notified_at
             FROM user_achievements
             WHERE user_id = ?`,
            [userId]
        );
        payload = buildAchievementsPayload(totalCompletedRounds, rows);
        payload.newlyUnlocked = payload.achievements.filter((achievement) =>
            keys.includes(achievement.key)
        );
    }

    if (Array.isArray(payload?.newlyUnlocked) && payload.newlyUnlocked.length) {
        emitAdminChange("achievement_unlocked", {
            userId: Number(userId) || 0,
            count: payload.newlyUnlocked.length
        });
        emitRoundChange("achievement_unlocked", {
            userId: Number(userId) || 0,
            count: payload.newlyUnlocked.length
        });
    }

    return payload;
}

async function getProfileComments(profileUserId, currentUserId = 0) {
    const viewerIdRaw = Number(currentUserId);
    const viewerId = Number.isInteger(viewerIdRaw) && viewerIdRaw > 0 ? viewerIdRaw : 0;
    return dbAll(
        `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at, c.updated_at, c.parent_comment_id,
                u.id AS user_id, u.username, u.nickname, u.avatar_url,
                (SELECT COUNT(*) FROM profile_comment_likes l WHERE l.comment_id = c.id) AS likes_count,
                CASE
                    WHEN ? > 0 AND EXISTS (
                        SELECT 1
                        FROM profile_comment_likes l2
                        WHERE l2.comment_id = c.id
                          AND l2.user_id = ?
                    ) THEN 1
                    ELSE 0
                END AS liked_by_me
         FROM profile_comments c
         JOIN users u ON u.id = c.author_user_id
         WHERE c.profile_user_id = ?
         ORDER BY COALESCE(c.updated_at, c.created_at) ASC, c.id ASC
         LIMIT 150`,
        [viewerId, viewerId, profileUserId]
    );
}

async function syncAchievementsForRoundParticipants(roundId) {
    const participantRows = await dbAll(
        `SELECT DISTINCT user_id
         FROM round_participants
         WHERE round_id = ?`,
        [roundId]
    );
    for (const row of participantRows) {
        const userId = Number(row?.user_id || 0);
        if (!Number.isInteger(userId) || userId <= 0) continue;
        try {
            await syncUserAchievements(userId, { markNewAsNotified: false });
        } catch (error) {
            console.error("[round-achievement-sync]", { roundId, userId, error: error?.message || error });
        }
    }
}

async function getRoundPayload(roundId, currentUserId) {
    const round = await dbGet(
        `SELECT r.id, r.creator_user_id, r.status, r.created_at, r.started_at, r.rating_starts_at, r.closed_at,
                u.username AS creator_username, u.nickname AS creator_nickname, u.avatar_url AS creator_avatar
         FROM rounds r
         JOIN users u ON u.id = r.creator_user_id
         WHERE r.id = ? LIMIT 1`,
        [roundId]
    );
    if (!round) return null;

    const participants = await getRoundParticipants(roundId);
    const assignmentsRaw = await getRoundAssignments(roundId);
    const pairExclusions = await getRoundPairExclusions(roundId);
    const shouldMaskAssignmentReceiver = round.status === "reveal";
    const assignments = assignmentsRaw.map((item) => {
        if (!shouldMaskAssignmentReceiver) return item;
        if (item.revealed) return item;
        return {
            ...item,
            receiver_username: null,
            receiver_nickname: null,
            receiver_avatar: null
        };
    });
    const recommendations = await getRoundRecommendations(roundId, currentUserId);

    const myAssignment = assignments.find((item) => item.giver_user_id === currentUserId) || null;
    const myRecommendation =
        recommendations.find((item) => item.giver_user_id === currentUserId) || null;
    const ratingsToDo = recommendations.filter((item) => item.receiver_user_id === currentUserId);
    const now = nowInSeconds();
    const ratingStartsAt = round.rating_starts_at || null;
    const roundStatus = String(round.status || "");
    const isReopened = roundStatus === "reopened";
    const ratingOpen = isReopened ? true : (ratingStartsAt ? now >= ratingStartsAt : false);
    let phase = round.status;
    if (isReopened) {
        phase = "rating";
    } else if (round.status === "indication" && ratingOpen) {
        phase = "rating";
    }

    return {
        ...round,
        participants,
        assignments,
        recommendations,
        pair_exclusions: pairExclusions,
        myAssignment,
        myRecommendation,
        ratingsToDo,
        ratingOpen,
        phase,
        isReopened,
        isCreator: round.creator_user_id === currentUserId
    };
}

async function ensurePairRows(participantIds) {
    for (const giverId of participantIds) {
        for (const receiverId of participantIds) {
            if (giverId === receiverId) continue;
            await dbRun(
                `INSERT OR IGNORE INTO pair_history
                    (giver_user_id, receiver_user_id, used_in_cycle, total_count)
                 VALUES (?, ?, 0, 0)`,
                [giverId, receiverId]
            );
        }
    }
}

async function resetExhaustedGivers(participantIds, blockedPairsSet = new Set()) {
    for (const giverId of participantIds) {
        const receiverIds = participantIds.filter(
            (id) => id !== giverId && !blockedPairsSet.has(pairKey(giverId, id))
        );
        if (!receiverIds.length) continue;

        const placeholders = receiverIds.map(() => "?").join(", ");
        const rows = await dbAll(
            `SELECT receiver_user_id, used_in_cycle
             FROM pair_history
             WHERE giver_user_id = ? AND receiver_user_id IN (${placeholders})`,
            [giverId, ...receiverIds]
        );

        const allUsed = rows.length === receiverIds.length && rows.every((row) => row.used_in_cycle === 1);
        if (allUsed) {
            await dbRun(
                `UPDATE pair_history
                 SET used_in_cycle = 0
                 WHERE giver_user_id = ? AND receiver_user_id IN (${placeholders})`,
                [giverId, ...receiverIds]
            );
        }
    }
}

async function buildAllowedReceivers(participantIds, blockedPairsSet = new Set()) {
    const allowed = new Map();
    for (const giverId of participantIds) {
        const receiverIds = participantIds.filter(
            (id) => id !== giverId && !blockedPairsSet.has(pairKey(giverId, id))
        );
        if (!receiverIds.length) {
            allowed.set(giverId, []);
            continue;
        }

        const placeholders = receiverIds.map(() => "?").join(", ");
        const rows = await dbAll(
            `SELECT receiver_user_id, used_in_cycle
             FROM pair_history
             WHERE giver_user_id = ? AND receiver_user_id IN (${placeholders})`,
            [giverId, ...receiverIds]
        );
        const available = rows.filter((row) => row.used_in_cycle === 0).map((row) => row.receiver_user_id);
        allowed.set(giverId, available);
    }
    return allowed;
}

function findDerangementAssignments(participantIds, allowedMap) {
    const givers = [...participantIds].sort((a, b) => {
        const aCount = (allowedMap.get(a) || []).length;
        const bCount = (allowedMap.get(b) || []).length;
        return aCount - bCount;
    });
    const usedReceivers = new Set();
    const result = new Map();

    function backtrack(index) {
        if (index >= givers.length) return true;
        const giver = givers[index];
        const options = shuffleArray((allowedMap.get(giver) || []).filter((id) => !usedReceivers.has(id)));
        for (const receiver of options) {
            result.set(giver, receiver);
            usedReceivers.add(receiver);
            if (backtrack(index + 1)) return true;
            result.delete(giver);
            usedReceivers.delete(receiver);
        }
        return false;
    }

    return backtrack(0) ? result : null;
}
async function generateAssignmentsWithRotation(participantIds, blockedPairs = []) {
    if (participantIds.length < 2) {
        throw new Error("Você precisa de ao menos 2 participantes para sortear.");
    }

    const blockedPairsSet = toBlockedPairsSet(blockedPairs);

    await ensurePairRows(participantIds);
    await resetExhaustedGivers(participantIds, blockedPairsSet);
    let allowed = await buildAllowedReceivers(participantIds, blockedPairsSet);
    let assignmentMap = findDerangementAssignments(participantIds, allowed);

    if (!assignmentMap) {
        for (const giverId of participantIds) {
            const receiverIds = participantIds.filter(
                (id) => id !== giverId && !blockedPairsSet.has(pairKey(giverId, id))
            );
            if (!receiverIds.length) continue;
            const placeholders = receiverIds.map(() => "?").join(", ");
            await dbRun(
                `UPDATE pair_history SET used_in_cycle = 0
                 WHERE giver_user_id = ? AND receiver_user_id IN (${placeholders})`,
                [giverId, ...receiverIds]
            );
        }
        allowed = await buildAllowedReceivers(participantIds, blockedPairsSet);
        assignmentMap = findDerangementAssignments(participantIds, allowed);
    }

    if (!assignmentMap) {
        throw new Error(
            "Nao foi possivel montar um sorteio valido com as restricoes atuais. Tente ajustar participantes/pares."
        );
    }

    return assignmentMap;
}

async function saveAssignments(roundId, assignmentMap) {
    await dbRun("DELETE FROM round_assignments WHERE round_id = ?", [roundId]);
    for (const [giverId, receiverId] of assignmentMap.entries()) {
        await dbRun(
            `INSERT INTO round_assignments (round_id, giver_user_id, receiver_user_id)
             VALUES (?, ?, ?)`,
            [roundId, giverId, receiverId]
        );
        await dbRun(
            `UPDATE pair_history
             SET used_in_cycle = 1,
                 total_count = total_count + 1,
                 last_assigned_at = ?
             WHERE giver_user_id = ? AND receiver_user_id = ?`,
            [nowInSeconds(), giverId, receiverId]
        );
    }
}

async function deleteRoundCascade(roundId) {
    const recRows = await dbAll("SELECT id FROM recommendations WHERE round_id = ?", [roundId]);
    const recIds = recRows.map((row) => row.id);
    if (recIds.length) {
        const placeholders = recIds.map(() => "?").join(", ");
        const commentRows = await dbAll(
            `SELECT id FROM recommendation_comments WHERE recommendation_id IN (${placeholders})`,
            recIds
        );
        const commentIds = commentRows.map((row) => row.id);
        if (commentIds.length) {
            const commentPlaceholders = commentIds.map(() => "?").join(", ");
            await dbRun(
                `DELETE FROM recommendation_comment_likes
                 WHERE comment_id IN (${commentPlaceholders})`,
                commentIds
            );
        }
        await dbRun(`DELETE FROM recommendation_comments WHERE recommendation_id IN (${placeholders})`, recIds);
        await dbRun(`DELETE FROM recommendation_ratings WHERE recommendation_id IN (${placeholders})`, recIds);
    }
    await dbRun("DELETE FROM recommendations WHERE round_id = ?", [roundId]);
    await dbRun("DELETE FROM round_assignments WHERE round_id = ?", [roundId]);
    await dbRun("DELETE FROM round_pair_exclusions WHERE round_id = ?", [roundId]);
    await dbRun("DELETE FROM round_participants WHERE round_id = ?", [roundId]);
    await dbRun("DELETE FROM rounds WHERE id = ?", [roundId]);
}

async function deleteUserCascade(userId) {
    const ownedRounds = await dbAll("SELECT id FROM rounds WHERE creator_user_id = ?", [userId]);
    for (const round of ownedRounds) {
        await deleteRoundCascade(round.id);
    }

    const recRows = await dbAll(
        "SELECT id FROM recommendations WHERE giver_user_id = ? OR receiver_user_id = ?",
        [userId, userId]
    );
    const recIds = recRows.map((row) => row.id);
    if (recIds.length) {
        const placeholders = recIds.map(() => "?").join(", ");
        const commentRows = await dbAll(
            `SELECT id FROM recommendation_comments WHERE recommendation_id IN (${placeholders})`,
            recIds
        );
        const commentIds = commentRows.map((row) => row.id);
        if (commentIds.length) {
            const commentPlaceholders = commentIds.map(() => "?").join(", ");
            await dbRun(
                `DELETE FROM recommendation_comment_likes
                 WHERE comment_id IN (${commentPlaceholders})`,
                commentIds
            );
        }
        await dbRun(`DELETE FROM recommendation_comments WHERE recommendation_id IN (${placeholders})`, recIds);
        await dbRun(`DELETE FROM recommendation_ratings WHERE recommendation_id IN (${placeholders})`, recIds);
        await dbRun(`DELETE FROM recommendations WHERE id IN (${placeholders})`, recIds);
    }

    const ownRecCommentRows = await dbAll("SELECT id FROM recommendation_comments WHERE user_id = ?", [userId]);
    const ownRecCommentIds = ownRecCommentRows.map((row) => row.id);
    if (ownRecCommentIds.length) {
        const placeholders = ownRecCommentIds.map(() => "?").join(", ");
        await dbRun(
            `DELETE FROM recommendation_comment_likes
             WHERE comment_id IN (${placeholders})`,
            ownRecCommentIds
        );
    }
    await dbRun("DELETE FROM recommendation_comments WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM recommendation_comment_likes WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM recommendation_ratings WHERE rater_user_id = ?", [userId]);
    const profileCommentRows = await dbAll(
        "SELECT id FROM profile_comments WHERE profile_user_id = ? OR author_user_id = ?",
        [userId, userId]
    );
    const profileCommentIds = profileCommentRows.map((row) => row.id);
    if (profileCommentIds.length) {
        const placeholders = profileCommentIds.map(() => "?").join(", ");
        await dbRun(
            `DELETE FROM profile_comment_likes
             WHERE comment_id IN (${placeholders})`,
            profileCommentIds
        );
    }
    await dbRun("DELETE FROM profile_comment_likes WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM profile_comments WHERE profile_user_id = ? OR author_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM round_assignments WHERE giver_user_id = ? OR receiver_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM round_pair_exclusions WHERE giver_user_id = ? OR receiver_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM round_participants WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM pair_history WHERE giver_user_id = ? OR receiver_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM password_resets WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM suggestions WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM user_achievement_gates WHERE user_id = ?", [userId]);
    await dbRun(
        "DELETE FROM admin_action_requests WHERE requester_user_id = ? OR decided_by_user_id = ?",
        [userId, userId]
    );
    await dbRun("DELETE FROM users WHERE id = ?", [userId]);
}

function isModeratorOnlyUser(userLike) {
    return Boolean(userLike?.isModerator) && !Boolean(userLike?.isOwner);
}

function buildAdminUserDisplayName(userRow) {
    return normalizeNickname(userRow?.nickname, userRow?.username);
}

async function getUserForAdminById(userId) {
    return dbGet(
        `SELECT id, username, nickname, email, blocked, is_moderator
         FROM users
         WHERE id = ? LIMIT 1`,
        [userId]
    );
}

async function prepareAdminActionPayload(actionType, rawPayload, actorUser) {
    const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
    const ensureTargetUser = async () => {
        const targetUserId = Number(payload?.targetUserId || 0);
        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
            const error = new Error("Usuário inválido.");
            error.statusCode = 400;
            throw error;
        }
        const targetUser = await getUserForAdminById(targetUserId);
        if (!targetUser) {
            const error = new Error("Usuário não encontrado.");
            error.statusCode = 404;
            throw error;
        }
        const targetFlags = buildRoleFlags(targetUser);
        if (targetFlags.isOwner && ["user_block", "user_delete", "set_role"].includes(actionType)) {
            const error = new Error("Nao e permitido modificar a conta dona.");
            error.statusCode = 400;
            throw error;
        }
        if (isModeratorOnlyUser(actorUser)) {
            if (targetFlags.isOwner) {
                const error = new Error("Moderador não pode modificar a conta do dono.");
                error.statusCode = 403;
                throw error;
            }
            if (targetFlags.isModerator && Number(targetUser.id) !== Number(actorUser.id)) {
                const error = new Error("Moderador não pode modificar outro moderador.");
                error.statusCode = 403;
                throw error;
            }
        }
        return { targetUser, targetFlags };
    };

    if (actionType === "user_block") {
        const { targetUser } = await ensureTargetUser();
        const blocked = Number(payload?.blocked) === 1 ? 1 : 0;
        return {
            targetUserId: Number(targetUser.id),
            targetUserName: buildAdminUserDisplayName(targetUser),
            blocked
        };
    }

    if (actionType === "user_delete") {
        const { targetUser } = await ensureTargetUser();
        return {
            targetUserId: Number(targetUser.id),
            targetUserName: buildAdminUserDisplayName(targetUser)
        };
    }

    if (actionType === "achievement_grant" || actionType === "achievement_revoke" || actionType === "achievement_reset_all") {
        const { targetUser } = await ensureTargetUser();
        const normalized = {
            targetUserId: Number(targetUser.id),
            targetUserName: buildAdminUserDisplayName(targetUser)
        };
        if (actionType !== "achievement_reset_all") {
            const achievementKey = sanitizeText(payload?.achievementKey || "", 40);
            const validAchievement = ACHIEVEMENT_DEFINITIONS.find((item) => item.key === achievementKey);
            if (!validAchievement) {
                const error = new Error("Conquista inv?lida.");
                error.statusCode = 400;
                throw error;
            }
            if (actionType === "achievement_revoke") {
                const unlocked = await dbGet(
                    `SELECT user_id
                     FROM user_achievements
                     WHERE user_id = ? AND achievement_key = ?
                     LIMIT 1`,
                    [Number(targetUser.id), achievementKey]
                );
                if (!unlocked) {
                    const error = new Error("Conquista inexistente.");
                    error.statusCode = 400;
                    throw error;
                }
            }
            normalized.achievementKey = achievementKey;
        }
        return normalized;
    }

    if (actionType === "round_close" || actionType === "round_delete") {
        const roundId = Number(payload?.roundId || 0);
        if (!Number.isInteger(roundId) || roundId <= 0) {
            const error = new Error("Rodada inv?lida.");
            error.statusCode = 400;
            throw error;
        }
        const round = await dbGet(
            `SELECT id, status, creator_user_id
             FROM rounds
             WHERE id = ? LIMIT 1`,
            [roundId]
        );
        if (!round) {
            const error = new Error("Rodada não encontrada.");
            error.statusCode = 404;
            throw error;
        }
        return {
            roundId: Number(round.id),
            roundStatus: String(round.status || ""),
            creatorUserId: Number(round.creator_user_id || 0)
        };
    }

    if (actionType === "set_role") {
        if (!actorUser?.isOwner) {
            const error = new Error("Apenas o dono pode alterar cargos.");
            error.statusCode = 403;
            throw error;
        }
        const { targetUser } = await ensureTargetUser();
        const role = String(payload?.role || "").trim().toLowerCase() === "moderator" ? "moderator" : "user";
        return {
            targetUserId: Number(targetUser.id),
            targetUserName: buildAdminUserDisplayName(targetUser),
            role
        };
    }

    const error = new Error("A??o administrativa inv?lida.");
    error.statusCode = 400;
    throw error;
}

async function executePreparedAdminAction(actionType, preparedPayload, actorUserId = 0) {
    if (actionType === "user_block") {
        const blocked = Number(preparedPayload.blocked) === 1 ? 1 : 0;
        await dbRun(
            "UPDATE users SET blocked = ? WHERE id = ?",
            [blocked, Number(preparedPayload.targetUserId)]
        );
        return {
            message: blocked ? "Conta bloqueada." : "Conta desbloqueada."
        };
    }

    if (actionType === "user_delete") {
        await deleteUserCascade(Number(preparedPayload.targetUserId));
        return { message: "Conta excluída." };
    }

    if (actionType === "achievement_grant") {
        const now = nowInSeconds();
        await dbRun(
            `INSERT INTO user_achievements (user_id, achievement_key, unlocked_at, notified_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, achievement_key) DO UPDATE SET unlocked_at = excluded.unlocked_at`,
            [
                Number(preparedPayload.targetUserId),
                String(preparedPayload.achievementKey || ""),
                now,
                now
            ]
        );
        return { message: `Conquista ${String(preparedPayload.achievementKey || "")} concedida.` };
    }

    if (actionType === "achievement_revoke") {
        const now = nowInSeconds();
        const row = await dbGet(
            `SELECT user_id
             FROM user_achievements
             WHERE user_id = ? AND achievement_key = ?
             LIMIT 1`,
            [Number(preparedPayload.targetUserId), String(preparedPayload.achievementKey || "")]
        );
        if (!row) {
            const error = new Error("Conquista inexistente.");
            error.statusCode = 400;
            throw error;
        }
        await dbRun(
            `DELETE FROM user_achievements
             WHERE user_id = ? AND achievement_key = ?`,
            [Number(preparedPayload.targetUserId), String(preparedPayload.achievementKey || "")]
        );
        await dbRun(
            `INSERT INTO user_achievement_gates (user_id, achievement_key, gated_after)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id, achievement_key) DO UPDATE SET gated_after = excluded.gated_after`,
            [Number(preparedPayload.targetUserId), String(preparedPayload.achievementKey || ""), now]
        );
        return { message: `Conquista ${String(preparedPayload.achievementKey || "")} removida.` };
    }

    if (actionType === "achievement_reset_all") {
        const userId = Number(preparedPayload.targetUserId);
        const now = nowInSeconds();
        await dbRun(
            "DELETE FROM user_achievements WHERE user_id = ?",
            [userId]
        );
        for (const definition of ACHIEVEMENT_DEFINITIONS) {
            await dbRun(
                `INSERT INTO user_achievement_gates (user_id, achievement_key, gated_after)
                 VALUES (?, ?, ?)
                 ON CONFLICT(user_id, achievement_key) DO UPDATE SET gated_after = excluded.gated_after`,
                [userId, String(definition.key || ""), now]
            );
        }
        return { message: "Conquistas zeradas." };
    }

    if (actionType === "round_close") {
        const roundId = Number(preparedPayload.roundId || 0);
        const round = await dbGet("SELECT id, status, reopened_count FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!round) {
            const error = new Error("Rodada não encontrada.");
            error.statusCode = 404;
            throw error;
        }
        if (String(round.status || "") === "closed") {
            await dbRun(
                `UPDATE rounds
                 SET status = 'reopened',
                     rating_starts_at = ?,
                     closed_at = NULL,
                     reopened_count = COALESCE(reopened_count, 0) + 1
                 WHERE id = ?`,
                [nowInSeconds(), roundId]
            );
            emitRoundChange("round_reopened", {
                roundId,
                status: "reopened",
                actorUserId: Number(actorUserId || 0)
            });
            return { message: "Rodada reaberta para edição de notas navais." };
        }
        if (String(round.status || "") === "reopened") {
            await dbRun(
                "UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?",
                [nowInSeconds(), roundId]
            );
            emitRoundChange("round_reopened_finalized", {
                roundId,
                status: "closed",
                actorUserId: Number(actorUserId || 0)
            });
            return { message: "Rodada reaberta finalizada." };
        }
        await dbRun(
            "UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?",
            [nowInSeconds(), roundId]
        );
        await syncAchievementsForRoundParticipants(roundId);
        emitRoundChange("round_closed", {
            roundId,
            status: "closed",
            actorUserId: Number(actorUserId || 0)
        });
        return { message: "Rodada encerrada." };
    }

    if (actionType === "round_delete") {
        const roundId = Number(preparedPayload.roundId || 0);
        await deleteRoundCascade(roundId);
        emitRoundChange("round_deleted", {
            roundId,
            actorUserId: Number(actorUserId || 0)
        });
        return { message: "Rodada excluída." };
    }

    if (actionType === "set_role") {
        const isModerator = String(preparedPayload.role || "").trim().toLowerCase() === "moderator" ? 1 : 0;
        await dbRun(
            "UPDATE users SET is_moderator = ? WHERE id = ?",
            [isModerator, Number(preparedPayload.targetUserId || 0)]
        );
        return {
            message: isModerator ? "Usuário promovido a moderador." : "Usuário removido de moderador."
        };
    }

    const error = new Error("A??o administrativa inv?lida.");
    error.statusCode = 400;
    throw error;
}

function buildAdminActionRequestResponse(row) {
    const payload = parseJsonSafely(row?.payload_json, {});
    const actionType = String(row?.action_type || row?.action_key || "").trim();
    const status = String(row?.status || "").trim();
    return {
        id: Number(row?.id || 0),
        action_type: actionType,
        status,
        status_label: actionStatusLabel(status),
        action_label: adminActionLabel(actionType, payload),
        detail_lines: adminActionDetailLines(actionType, payload),
        requester_user_id: Number(row?.requester_user_id || 0),
        requester_name: sanitizeText(row?.requester_name || "", 120),
        created_at: Number(row?.created_at || 0),
        expires_at: Number(row?.expires_at || 0),
        decided_at: Number(row?.decided_at || 0),
        result_message: sanitizeText(row?.result_message || "", 400)
    };
}

async function queueOrExecuteAdminAction(actorUser, actionType, rawPayload) {
    const preparedPayload = await prepareAdminActionPayload(actionType, rawPayload, actorUser);
    if (isModeratorOnlyUser(actorUser)) {
        await createAdminActionRequest(Number(actorUser.id), actionType, preparedPayload);
        return {
            pendingApproval: true,
            message: "Solicitacao enviada ao dono para aprovacao."
        };
    }
    const result = await executePreparedAdminAction(actionType, preparedPayload, Number(actorUser?.id) || 0);
    emitAdminChange("admin_action_executed", {
        actorUserId: Number(actorUser?.id) || 0,
        actionType: sanitizeText(actionType, 80)
    });
    return {
        pendingApproval: false,
        ...result
    };
}

async function getPendingOwnerActionRequests() {
    await pruneExpiredAdminActionRequests();
    const rows = await dbAll(
        `SELECT ar.*,
                COALESCE(u.nickname, u.username) AS requester_name
         FROM admin_action_requests ar
         JOIN users u ON u.id = ar.requester_user_id
         WHERE ar.status = 'pending'
           AND ar.expires_at >= ?
         ORDER BY ar.created_at DESC, ar.id DESC`,
        [nowInSeconds()]
    );
    return rows.map((row) => buildAdminActionRequestResponse(row));
}

async function getLatestResolvedAdminActionForRequester(userId) {
    const row = await dbGet(
        `SELECT ar.*,
                COALESCE(u.nickname, u.username) AS requester_name
         FROM admin_action_requests ar
         JOIN users u ON u.id = ar.requester_user_id
         WHERE ar.requester_user_id = ?
           AND ar.status IN ('approved', 'denied')
         ORDER BY COALESCE(ar.decided_at, ar.created_at) DESC, ar.id DESC
         LIMIT 1`,
        [userId]
    );
    return row ? buildAdminActionRequestResponse(row) : null;
}

async function getOwnerSuggestionsList() {
    const rows = await dbAll(
        `SELECT s.id, s.user_id, s.target_page, s.suggestion_text, s.created_at,
                u.username AS author_username, u.nickname AS author_nickname
         FROM suggestions s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 200`
    );
    return rows.map((row) => ({
        id: Number(row.id),
        user_id: Number(row.user_id),
        target_page: sanitizeText(row.target_page, 20),
        suggestion_text: sanitizeText(row.suggestion_text, 1000),
        created_at: Number(row.created_at || 0),
        author_username: sanitizeText(row.author_username, 120),
        author_nickname: sanitizeText(row.author_nickname, 120)
    }));
}

function requireRoundCreator(round, req, res) {
    if (!round) {
        res.status(404).json({ message: "Rodada não encontrada." });
        return false;
    }
    const canManageDraftStage =
        Boolean(req.currentUser?.isOwner)
        || Boolean(req.currentUser?.isModerator)
        || Number(round.creator_user_id) === Number(req.session.userId);
    if (!canManageDraftStage) {
        res.status(403).json({ message: "Apenas o criador, dono ou adm pode fazer isso." });
        return false;
    }
    return true;
}

function normalizeNickname(nickname, username) {
    const cleaned = sanitizeText(nickname, 30);
    return cleaned || nicknameFromUsername(username);
}

async function assertNicknameAvailable(nickname, excludeUserId = 0) {
    const clean = sanitizeText(nickname, 30);
    if (!clean) return;

    const inUsers = await nicknameExists(clean, excludeUserId);
    if (inUsers) {
        throw new Error("Nickname ja esta em uso.");
    }
}

const sessionSecret = process.env.SESSION_SECRET || (isProduction ? null : randomSecretHex());
if (!sessionSecret) {
    throw new Error("SESSION_SECRET obrigatorio em producao.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: ["'self'", "data:", "blob:", "https:"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"]
            }
        },
        hsts: isProduction
            ? {
                  maxAge: 31536000,
                  includeSubDomains: true,
                  preload: true
              }
            : false
    })
);

app.use(express.json({ limit: "150kb" }));
app.use(express.urlencoded({ extended: false, limit: "150kb" }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 800 : 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Muitas requisicoes. Tente novamente em instantes." }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 25 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Muitas tentativas de autenticacao. Aguarde e tente novamente." }
});
app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use("/auth", authLimiter);

app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const isProtectedPath = req.path.startsWith("/api/") || req.path.startsWith("/auth/");
    if (!isProtectedPath) return next();

    const origin = req.get("origin");
    const referer = req.get("referer");

    if (origin && !isAllowedOrigin(origin, req)) {
        return res.status(403).json({ message: "Origem da requisição não permitida." });
    }

    if (!origin && referer) {
        const refererOrigin = parseOrigin(referer);
        if (!refererOrigin) {
            return res.status(403).json({ message: "Referer inv?lido." });
        }
        if (!isAllowedOrigin(refererOrigin, req)) {
            return res.status(403).json({ message: "Referer da requisição não permitido." });
        }
    }

    return next();
});

app.use(
    session({
        store: new SQLiteStore({
            db: "sessions.sqlite",
            dir: __dirname
        }),
        name: "clube.sid",
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: isProduction,
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);
app.use(passport.initialize());
app.use(
    "/uploads",
    express.static(uploadRoot, {
        index: false,
        maxAge: isProduction ? "7d" : 0
    })
);

app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    const pathname = req.path === "/" ? "/" : req.path.toLowerCase();
    const isHtml = pathname === "/" || pathname.endsWith(".html");
    if (!isHtml) return next();

    if ((pathname === "/" || !publicHtmlRoutes.has(pathname)) && !req.session.userId) {
        return res.redirect("/login.html");
    }

    if (redirectWhenAuthenticatedRoutes.has(pathname) && req.session.userId) {
        return res.redirect("/");
    }

    return next();
});

const registerPublicAuthRoutes = require("./src/routes/public-auth.routes");
const registerUserRoutes = require("./src/routes/user.routes");
const registerAdminRoutes = require("./src/routes/admin.routes");
const registerRoundRoutes = require("./src/routes/round.routes");

const routeDeps = {
    adminEventClients,
    adminEventClientSeq,
    assertNicknameAvailable,
    avatarUpload,
    baseUrl,
    bcrypt,
    buildRoleFlags,
    cleanupRoundPairExclusions,
    coverUpload,
    createPasswordResetForUser,
    createToken,
    createVerificationCode,
    dbAll,
    dbGet,
    dbRun,
    deleteRoundCascade,
    emitAdminChange,
    emitRoundChange,
    emitRoundChangeForRecommendation,
    executePreparedAdminAction,
    express,
    fs,
    generateAssignmentsWithRotation,
    generateAvailableNickname,
    generateAvailableUsername,
    getActiveRound,
    getGoogleCallbackUrl,
    getLatestResolvedAdminActionForRequester,
    getOwnerSuggestionsList,
    getPendingAdminActionForRequester,
    getPendingOwnerActionRequests,
    getProfileComments,
    getPublicBaseUrl,
    getRawgGameDetailsByName,
    getRequestOrigin,
    getRoundPairExclusions,
    getRoundParticipants,
    getRoundParticipantsCompact,
    getRoundPayload,
    getRoundRecommendations,
    getSteamAppDetails,
    getUserBasicById,
    getUserProfileActivity,
    googleEnabled,
    isAllowedRatingLetter,
    isOwnerEmail,
    isValidEmail,
    listUserRolesForClient,
    maskEmailForDisplay,
    normalizeNickname,
    nowInSeconds,
    parseJsonSafely,
    parseOrigin,
    passport,
    path,
    port,
    pruneExpiredAdminActionRequests,
    publicAppUrl,
    publicDir,
    queueOrExecuteAdminAction,
    requireAdminAccess,
    requireAuth,
    requireOwner,
    requireRoundCreator,
    resolveManualGameMetadataByName,
    roundEventClients,
    roundEventClientSeq,
    sanitizeAndSavePairExclusions,
    sanitizeText,
    saveAssignments,
    searchSteamGames,
    seemsMostlyEnglishText,
    seemsPortugueseText,
    sendVerificationEmail,
    session,
    sha256,
    syncAchievementsForRoundParticipants,
    syncUserAchievements,
    uploadRoot,
    validatePairRestrictions,
};

registerPublicAuthRoutes(app, routeDeps);
registerUserRoutes(app, routeDeps);
registerAdminRoutes(app, routeDeps);
registerRoundRoutes(app, routeDeps);
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ message: error.message });
    }
    if (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro interno no servidor." });
    }
    return next();
});

initDb()
    .then(() => {
        app.listen(port, () => {
            console.log(`Servidor Clube do Jogo iniciado em ${baseUrl}`);
        });
    })
    .catch((error) => {
        console.error("Falha ao inicializar banco de dados.", error);
        process.exit(1);
    });

