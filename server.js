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

const db = new sqlite3.Database(path.join(__dirname, "app.db"));
const SQLiteStore = SQLiteStoreFactory(session);

const uploadRoot = path.join(__dirname, "uploads");
const avatarDir = path.join(uploadRoot, "avatars");
const coverDir = path.join(uploadRoot, "covers");
fs.mkdirSync(avatarDir, { recursive: true });
fs.mkdirSync(coverDir, { recursive: true });

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
        return {
            appId: numericAppId,
            name: sanitizeText(data.name || `App ${numericAppId}`, 120),
            description: sanitizeText(data.short_description || "", 600),
            headerImage: data.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${numericAppId}/header.jpg`,
            libraryImage: `https://cdn.cloudflare.steamstatic.com/steam/apps/${numericAppId}/library_600x900_2x.jpg`
        };
    } catch {
        return null;
    }
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

async function pendingNicknameExists(nickname) {
    const clean = sanitizeText(nickname, 30);
    if (!clean) return false;
    const exists = await dbGet(
        `SELECT email FROM pending_registrations
         WHERE LOWER(COALESCE(nickname, '')) = LOWER(?)
         LIMIT 1`,
        [clean]
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
        if (inUsers) continue;
        const inPending = await pendingNicknameExists(candidate);
        if (!inPending) return candidate;
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
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif"
    };
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, targetDir),
        filename: (req, file, cb) => {
            const ext = extByMime[String(file.mimetype || "").toLowerCase()] || ".png";
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

const avatarUpload = createUploader(avatarDir, 5 * 1024 * 1024);
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
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE (round_id, giver_user_id),
            FOREIGN KEY (round_id) REFERENCES rounds(id),
            FOREIGN KEY (giver_user_id) REFERENCES users(id),
            FOREIGN KEY (receiver_user_id) REFERENCES users(id)
        )
    `);

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
        intro: "Recebemos uma solicitacao para criar sua conta no Clube do Jogo.",
        bodyHtml: `<p style="margin:0;">Seu codigo de confirmacao:</p>
                   <p style="margin:10px 0 6px;font-size:28px;font-weight:800;letter-spacing:3px;color:#6fd7ff;">${code}</p>
                   <p style="margin:0;color:#b9ccf4;">Este codigo expira em 10 minutos.</p>`
    });
    await sendEmail({
        to: email,
        subject: `${BRAND_NAME} | Codigo de confirmacao`,
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
        "SELECT id, username, email, blocked FROM users WHERE id = ? LIMIT 1",
        [req.session.userId]
    )
        .then((user) => {
            if (!user) {
                req.session.destroy(() => {});
                return res.status(401).json({ message: "Sessao invalida." });
            }
            if (Number(user.blocked) === 1) {
                req.session.destroy(() => {});
                return res.status(403).json({ message: "Conta bloqueada. Contate o dono do site." });
            }
            req.currentUser = {
                id: user.id,
                username: user.username,
                email: user.email,
                isOwner: isOwnerEmail(user.email)
            };
            return next();
        })
        .catch((error) => {
            console.error(error);
            return res.status(500).json({ message: "Erro ao validar sessao." });
        });
}

function requireOwner(req, res, next) {
    if (!req.currentUser?.isOwner) {
        return res.status(403).json({ message: "Apenas o dono do site pode fazer isso." });
    }
    return next();
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
                "Cada participante precisa ter pelo menos 1 pessoa possivel para receber sua indicacao."
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

async function getRoundRecommendations(roundId) {
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
                u.id AS user_id, u.username, u.nickname, u.avatar_url
         FROM recommendation_comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.recommendation_id IN (${placeholders})
         ORDER BY c.created_at ASC`,
        ids
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

async function getProfileComments(profileUserId) {
    return dbAll(
        `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at,
                u.id AS user_id, u.username, u.nickname, u.avatar_url
         FROM profile_comments c
         JOIN users u ON u.id = c.author_user_id
         WHERE c.profile_user_id = ?
         ORDER BY c.created_at DESC
         LIMIT 150`,
        [profileUserId]
    );
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
    const assignments = assignmentsRaw.map((item) => {
        if (item.revealed) return item;
        return {
            ...item,
            receiver_username: null,
            receiver_nickname: null,
            receiver_avatar: null
        };
    });
    const recommendations = await getRoundRecommendations(roundId);

    const myAssignment = assignments.find((item) => item.giver_user_id === currentUserId) || null;
    const myRecommendation =
        recommendations.find((item) => item.giver_user_id === currentUserId) || null;
    const ratingsToDo = recommendations.filter((item) => item.receiver_user_id === currentUserId);
    const now = nowInSeconds();
    const ratingStartsAt = round.rating_starts_at || null;
    const ratingOpen = ratingStartsAt ? now >= ratingStartsAt : false;
    let phase = round.status;
    if (round.status === "indication" && ratingOpen) {
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
        throw new Error("Voce precisa de ao menos 2 participantes para sortear.");
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
        await dbRun(`DELETE FROM recommendation_comments WHERE recommendation_id IN (${placeholders})`, recIds);
        await dbRun(`DELETE FROM recommendation_ratings WHERE recommendation_id IN (${placeholders})`, recIds);
        await dbRun(`DELETE FROM recommendations WHERE id IN (${placeholders})`, recIds);
    }

    await dbRun("DELETE FROM recommendation_comments WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM recommendation_ratings WHERE rater_user_id = ?", [userId]);
    await dbRun("DELETE FROM profile_comments WHERE profile_user_id = ? OR author_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM round_assignments WHERE giver_user_id = ? OR receiver_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM round_pair_exclusions WHERE giver_user_id = ? OR receiver_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM round_participants WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM pair_history WHERE giver_user_id = ? OR receiver_user_id = ?", [userId, userId]);
    await dbRun("DELETE FROM password_resets WHERE user_id = ?", [userId]);
    await dbRun("DELETE FROM users WHERE id = ?", [userId]);
}

function requireRoundCreator(round, req, res) {
    if (!round) {
        res.status(404).json({ message: "Rodada nao encontrada." });
        return false;
    }
    if (!req.currentUser?.isOwner && round.creator_user_id !== req.session.userId) {
        res.status(403).json({ message: "Apenas o criador da rodada pode fazer isso." });
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

    const inPending = await pendingNicknameExists(clean);
    if (inPending) {
        throw new Error("Nickname ja esta reservado em um cadastro pendente.");
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
                imgSrc: ["'self'", "data:", "https:"],
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
        return res.status(403).json({ message: "Origem da requisicao nao permitida." });
    }

    if (!origin && referer) {
        const refererOrigin = parseOrigin(referer);
        if (!refererOrigin) {
            return res.status(403).json({ message: "Referer invalido." });
        }
        if (!isAllowedOrigin(refererOrigin, req)) {
            return res.status(403).json({ message: "Referer da requisicao nao permitido." });
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

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname, { index: false }));

app.get("/auth/google", (req, res, next) => {
    if (!googleEnabled) {
        return res.redirect("/login.html?error=google_not_configured");
    }
    const callbackURL = getGoogleCallbackUrl(req);
    return passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "select_account",
        callbackURL
    })(req, res, next);
});

app.get("/auth/google/callback", (req, res, next) => {
    if (!googleEnabled) {
        return res.redirect("/login.html?error=google_not_configured");
    }

    const callbackURL = getGoogleCallbackUrl(req);
    const redirectBase = parseOrigin(req ? getRequestOrigin(req) : "")
        || parseOrigin(req?.get ? req.get("origin") : "")
        || parseOrigin(req?.get ? req.get("referer") : "")
        || publicAppUrl
        || parseOrigin(baseUrl)
        || `http://localhost:${port}`;
    const toLoginError = (code) => `${redirectBase}/login.html?error=${encodeURIComponent(code)}`;
    return passport.authenticate("google", { session: false, callbackURL }, async (error, profile) => {
        try {
            if (error || !profile) {
                console.error("[google callback error]", error);
                return res.redirect(toLoginError("google_auth_failed"));
            }

            const googleEmail = sanitizeText(profile?.emails?.[0]?.value, 120).toLowerCase();
            if (!googleEmail || !isValidEmail(googleEmail)) {
                return res.redirect(toLoginError("google_email_unavailable"));
            }

            let user = await dbGet(
                "SELECT id, username, email, nickname, blocked FROM users WHERE email = ? LIMIT 1",
                [googleEmail]
            );

            if (!user) {
                const beforeAt = googleEmail.split("@")[0] || "jogador";
                const username = await generateAvailableUsername(beforeAt);
                const nickname = await generateAvailableNickname(beforeAt, username);
                const randomPasswordHash = await bcrypt.hash(createToken(), 12);

                try {
                    await dbRun(
                        `INSERT INTO users
                            (username, email, password_hash, email_verified, nickname, created_at)
                         VALUES (?, ?, ?, 1, ?, ?)`,
                        [username, googleEmail, randomPasswordHash, nickname, nowInSeconds()]
                    );
                } catch (insertError) {
                    if (!String(insertError.message || "").includes("UNIQUE")) {
                        throw insertError;
                    }
                }
                await dbRun("DELETE FROM pending_registrations WHERE email = ?", [googleEmail]);
                user = await dbGet(
                    "SELECT id, username, email, nickname, blocked FROM users WHERE email = ? LIMIT 1",
                    [googleEmail]
                );
            }

            if (!user) {
                return res.redirect(toLoginError("google_auth_failed"));
            }
            if (Number(user.blocked) === 1) {
                return res.redirect(toLoginError("google_auth_failed"));
            }

            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.isOwner = isOwnerEmail(user.email);
            return req.session.save((sessionError) => {
                if (sessionError) {
                    console.error("[google session save error]", sessionError);
                    return res.redirect(toLoginError("google_auth_failed"));
                }
                return res.redirect(`${redirectBase}/`);
            });
        } catch (callbackError) {
            console.error(callbackError);
            return res.redirect(toLoginError("google_auth_failed"));
        }
    })(req, res, next);
});
app.post("/api/auth/register", async (req, res) => {
    try {
        const username = sanitizeText(req.body.username, 30);
        const nickname = normalizeNickname(req.body.nickname, username);
        const email = sanitizeText(req.body.email, 120).toLowerCase();
        const password = String(req.body.password || "");
        const phone = sanitizeText(req.body.phone, 30);

        if (!username || username.length < 3) {
            return res.status(400).json({ message: "Nome de usuario invalido." });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: "Email invalido." });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: "A senha precisa ter ao menos 8 caracteres." });
        }

        const existingUser = await dbGet(
            "SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1",
            [email, username]
        );
        if (existingUser) {
            return res.status(409).json({ message: "Email ou nome de usuario ja cadastrados." });
        }

        await dbRun("DELETE FROM pending_registrations WHERE email = ?", [email]);
        await assertNicknameAvailable(nickname);

        const passwordHash = await bcrypt.hash(password, 12);
        const code = createVerificationCode();
        const codeHash = await bcrypt.hash(code, 10);
        const expiresAt = nowInSeconds() + 60 * 10;
        await dbRun(
            `INSERT INTO pending_registrations
                (email, username, nickname, password_hash, phone, code_hash, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [email, username, nickname, passwordHash, phone, codeHash, expiresAt, nowInSeconds()]
        );

        await sendVerificationEmail(email, code);
        return res.json({ message: "Codigo enviado para o email informado." });
    } catch (error) {
        console.error(error);
        if (String(error.message || "").includes("Nickname ja")) {
            return res.status(409).json({ message: error.message });
        }
        if (String(error.message || "").includes("Falha no envio de email")) {
            return res.status(502).json({ message: error.message });
        }
        return res.status(500).json({ message: "Erro interno no cadastro." });
    }
});

app.post("/api/auth/verify-email", async (req, res) => {
    try {
        const email = sanitizeText(req.body.email, 120).toLowerCase();
        const code = sanitizeText(req.body.code, 10);

        const pending = await dbGet(
            "SELECT * FROM pending_registrations WHERE email = ? LIMIT 1",
            [email]
        );
        if (!pending) {
            return res.status(404).json({ message: "Cadastro pendente nao encontrado." });
        }
        if (pending.expires_at < nowInSeconds()) {
            await dbRun("DELETE FROM pending_registrations WHERE email = ?", [email]);
            return res.status(400).json({ message: "Codigo expirado. Faca o cadastro novamente." });
        }

        const validCode = await bcrypt.compare(code, pending.code_hash);
        if (!validCode) {
            return res.status(400).json({ message: "Codigo invalido." });
        }

        const finalNickname = normalizeNickname(pending.nickname, pending.username);
        await assertNicknameAvailable(finalNickname);

        await dbRun(
            `INSERT INTO users
                (username, email, password_hash, email_verified, nickname, phone, created_at)
             VALUES (?, ?, ?, 1, ?, ?, ?)`,
            [
                pending.username,
                pending.email,
                pending.password_hash,
                finalNickname,
                pending.phone || "",
                nowInSeconds()
            ]
        );
        await dbRun("DELETE FROM pending_registrations WHERE email = ?", [email]);

        return res.json({ message: "Email confirmado com sucesso." });
    } catch (error) {
        if (String(error.message || "").includes("Nickname ja")) {
            return res.status(409).json({ message: error.message });
        }
        if (String(error.message || "").includes("UNIQUE")) {
            return res.status(409).json({ message: "Conta ja confirmada para este email/usuario." });
        }
        console.error(error);
        return res.status(500).json({ message: "Erro ao confirmar email." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const email = sanitizeText(req.body.email, 120).toLowerCase();
        const password = String(req.body.password || "");

        const user = await dbGet(
            "SELECT id, username, email, password_hash, email_verified, blocked FROM users WHERE email = ? LIMIT 1",
            [email]
        );

        if (!user) {
            return res.status(401).json({ message: "Email ou senha invalidos." });
        }
        if (!user.email_verified) {
            return res.status(403).json({ message: "Email ainda nao confirmado." });
        }
        if (Number(user.blocked) === 1) {
            return res.status(403).json({ message: "Conta bloqueada. Contate o dono do site." });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ message: "Email ou senha invalidos." });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.isOwner = isOwnerEmail(user.email);
        return req.session.save((sessionError) => {
            if (sessionError) {
                console.error(sessionError);
                return res.status(500).json({ message: "Erro ao criar sessao." });
            }
            return res.json({ message: "Login efetuado." });
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro interno no login." });
    }
});

app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ message: "Logout efetuado." });
    });
});

app.get("/api/user/profile", requireAuth, async (req, res) => {
    try {
        const user = await dbGet(
            `SELECT id, username, email, nickname, avatar_url
             FROM users WHERE id = ? LIMIT 1`,
            [req.session.userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuario nao encontrado." });
        }
        user.nickname = normalizeNickname(user.nickname, user.username);
        return res.json({ profile: user, isOwner: Boolean(req.currentUser?.isOwner) });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar perfil." });
    }
});

app.get("/api/users/:userId/profile-view", requireAuth, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "Usuario invalido." });
        }
        const user = await dbGet(
            `SELECT id, username, nickname, avatar_url
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuario nao encontrado." });
        }
        user.nickname = normalizeNickname(user.nickname, user.username);
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
            `SELECT id, username, nickname, avatar_url
             FROM users WHERE id = ? LIMIT 1`,
            [userId]
        );
        if (!user) {
            return res.status(404).json({ message: "Usuario nao encontrado." });
        }
        user.nickname = normalizeNickname(user.nickname, user.username);
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

app.put("/api/user/profile", requireAuth, async (req, res) => {
    try {
        const current = await dbGet(
            "SELECT id, username, nickname FROM users WHERE id = ? LIMIT 1",
            [req.session.userId]
        );
        if (!current) {
            return res.status(404).json({ message: "Usuario nao encontrado." });
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

app.post("/api/user/avatar", requireAuth, (req, res) => {
    avatarUpload.single("avatar")(req, res, async (error) => {
        try {
            if (error) {
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
            return res.status(404).json({ message: "Usuario nao encontrado." });
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
            return res.status(400).json({ message: "Usuario invalido." });
        }
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuario nao encontrado." });
        const comments = await getProfileComments(userId);
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
        if (!exists) return res.status(404).json({ message: "Usuario nao encontrado." });
        const comments = await getProfileComments(userId);
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
            return res.status(400).json({ message: "Usuario invalido." });
        }
        const commentText = sanitizeText(req.body.commentText, 500);
        if (!commentText) {
            return res.status(400).json({ message: "Comentario vazio." });
        }
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuario nao encontrado." });
        const createdAt = nowInSeconds();
        const createdInsert = await dbRun(
            `INSERT INTO profile_comments (profile_user_id, author_user_id, comment_text, created_at)
             VALUES (?, ?, ?, ?)`,
            [userId, req.currentUser.id, commentText, createdAt]
        );
        const created = await dbGet(
            `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url
             FROM profile_comments c
             JOIN users u ON u.id = c.author_user_id
             WHERE c.id = ? LIMIT 1`,
            [createdInsert.lastID]
        );
        return res.json({ message: "Comentario publicado.", comment: created });
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
        if (!commentText) {
            return res.status(400).json({ message: "Comentario vazio." });
        }
        const exists = await dbGet("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!exists) return res.status(404).json({ message: "Usuario nao encontrado." });
        const createdAt = nowInSeconds();
        const createdInsert = await dbRun(
            `INSERT INTO profile_comments (profile_user_id, author_user_id, comment_text, created_at)
             VALUES (?, ?, ?, ?)`,
            [userId, req.currentUser.id, commentText, createdAt]
        );
        const created = await dbGet(
            `SELECT c.id, c.profile_user_id, c.comment_text, c.created_at,
                    u.id AS user_id, u.username, u.nickname, u.avatar_url
             FROM profile_comments c
             JOIN users u ON u.id = c.author_user_id
             WHERE c.id = ? LIMIT 1`,
            [createdInsert.lastID]
        );
        return res.json({ message: "Comentario publicado.", comment: created });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao comentar no perfil." });
    }
});

app.post("/api/auth/request-password-reset", async (req, res) => {
    try {
        const email = sanitizeText(req.body.email, 120).toLowerCase();
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: "Email invalido." });
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
            return res.status(400).json({ message: "Token invalido." });
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
            return res.status(400).json({ message: "Token invalido ou expirado." });
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
        return res.status(500).json({ message: "Erro ao listar usuarios." });
    }
});

app.get("/api/admin/dashboard", requireAuth, requireOwner, async (req, res) => {
    try {
        const users = await dbAll(
            `SELECT id, username, nickname, email, blocked, created_at
             FROM users
             ORDER BY id DESC
             LIMIT 200`
        );
        const rounds = await dbAll(
            `SELECT r.id, r.status, r.created_at, r.started_at, r.rating_starts_at, r.closed_at,
                    r.creator_user_id, u.username AS creator_username, u.nickname AS creator_nickname
             FROM rounds r
             JOIN users u ON u.id = r.creator_user_id
             ORDER BY r.id DESC
             LIMIT 200`
        );
        return res.json({ users, rounds });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar painel admin." });
    }
});

app.patch("/api/admin/users/:userId/block", requireAuth, requireOwner, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const blocked = Number(req.body.blocked) === 1 ? 1 : 0;
        const user = await dbGet("SELECT id, email FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!user) return res.status(404).json({ message: "Usuario nao encontrado." });
        if (isOwnerEmail(user.email)) {
            return res.status(400).json({ message: "Nao e permitido bloquear a conta dona." });
        }
        await dbRun("UPDATE users SET blocked = ? WHERE id = ?", [blocked, userId]);
        return res.json({ message: blocked ? "Conta bloqueada." : "Conta desbloqueada." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao alterar bloqueio da conta." });
    }
});

app.delete("/api/admin/users/:userId", requireAuth, requireOwner, async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const user = await dbGet("SELECT id, email FROM users WHERE id = ? LIMIT 1", [userId]);
        if (!user) return res.status(404).json({ message: "Usuario nao encontrado." });
        if (isOwnerEmail(user.email)) {
            return res.status(400).json({ message: "Nao e permitido excluir a conta dona." });
        }
        await deleteUserCascade(userId);
        return res.json({ message: "Conta excluida." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao excluir conta." });
    }
});

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

app.get("/api/rounds/:roundId", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const payload = await getRoundPayload(roundId, req.session.userId);
        if (!payload) {
            return res.status(404).json({ message: "Rodada nao encontrada." });
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
            return res.status(404).json({ message: "Usuario nao encontrado." });
        }

        await dbRun(
            `INSERT OR IGNORE INTO round_participants (round_id, user_id, added_at)
             VALUES (?, ?, ?)`,
            [roundId, userId, nowInSeconds()]
        );
        await cleanupRoundPairExclusions(roundId);

        const participants = await getRoundParticipants(roundId);
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
            return res.status(400).json({ message: "O criador da rodada nao pode ser removido." });
        }

        await dbRun("DELETE FROM round_participants WHERE round_id = ? AND user_id = ?", [roundId, userId]);
        await cleanupRoundPairExclusions(roundId);
        const participants = await getRoundParticipants(roundId);
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
            return res.status(400).json({ message: "Esta rodada nao esta mais na fase de sorteio." });
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
        return res.json({ message: "Sorteio realizado. Agora revele os pares antes das indicacoes.", round: payload });
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
            return res.status(400).json({ message: "A rodada nao esta na fase de revelacao." });
        }

        await dbRun(
            "UPDATE round_assignments SET revealed = 1 WHERE round_id = ? AND giver_user_id = ?",
            [roundId, giverUserId]
        );
        const payload = await getRoundPayload(roundId, req.session.userId);
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
            return res.status(400).json({ message: "A rodada nao esta pronta para iniciar indicacoes." });
        }

        const ratingStartsAtInput = Number(req.body.ratingStartsAt || 0);
        if (!Number.isInteger(ratingStartsAtInput) || ratingStartsAtInput <= nowInSeconds()) {
            return res.status(400).json({
                message: "Defina uma data futura para abrir a sessao de notas."
            });
        }

        await dbRun(
            "UPDATE rounds SET status = 'indication', rating_starts_at = ? WHERE id = ?",
            [ratingStartsAtInput, roundId]
        );
        const payload = await getRoundPayload(roundId, req.session.userId);
        return res.json({ message: "Sessao de indicacoes iniciada.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao iniciar sessao de indicacoes." });
    }
});

app.post("/api/rounds/:roundId/close", requireAuth, async (req, res) => {
    try {
        const roundId = Number(req.params.roundId);
        const round = await dbGet("SELECT * FROM rounds WHERE id = ? LIMIT 1", [roundId]);
        if (!requireRoundCreator(round, req, res)) return;
        if (round.status === "closed") {
            return res.status(400).json({ message: "A rodada ja esta encerrada." });
        }

        await dbRun("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?", [
            nowInSeconds(),
            roundId
        ]);
        return res.json({ message: "Rodada encerrada." });
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
            return res.status(404).json({ message: "Rodada nao encontrada." });
        }
        if (!req.currentUser?.isOwner && round.creator_user_id !== req.currentUser.id) {
            return res.status(403).json({ message: "Sem permissao para editar essa rodada." });
        }

        const updates = [];
        const params = [];

        if (req.body.status) {
            const allowed = new Set(["draft", "reveal", "indication", "closed"]);
            const status = String(req.body.status);
            if (!allowed.has(status)) {
                return res.status(400).json({ message: "Status de rodada invalido." });
            }
            updates.push("status = ?");
            params.push(status);
        }

        if (req.body.ratingStartsAt !== undefined) {
            const ts = Number(req.body.ratingStartsAt);
            if (!Number.isInteger(ts) || ts <= 0) {
                return res.status(400).json({ message: "Data de notas invalida." });
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
        if (!round) return res.status(404).json({ message: "Rodada nao encontrada." });
        if (!req.currentUser?.isOwner && round.creator_user_id !== req.currentUser.id) {
            return res.status(403).json({ message: "Sem permissao para excluir essa rodada." });
        }
        await deleteRoundCascade(roundId);
        return res.json({ message: "Rodada excluida." });
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
                return res.status(404).json({ message: "Rodada nao encontrada." });
            }
            if (round.status !== "indication") {
                return res.status(400).json({ message: "A rodada nao esta na fase de indicacoes." });
            }
            if (round.rating_starts_at && nowInSeconds() >= round.rating_starts_at) {
                return res.status(400).json({ message: "A fase de indicacoes encerrou. Agora a rodada esta em notas." });
            }

            const assignment = await dbGet(
                "SELECT giver_user_id, receiver_user_id FROM round_assignments WHERE round_id = ? AND giver_user_id = ? LIMIT 1",
                [roundId, req.session.userId]
            );
            if (!assignment) {
                return res.status(403).json({ message: "Voce nao possui indicacao ativa nesta rodada." });
            }

            let gameName = sanitizeText(req.body.gameName, 120);
            let gameDescription = sanitizeText(req.body.gameDescription, 500);
            const reason = sanitizeText(req.body.reason, 500);
            const steamAppId = sanitizeText(req.body.steamAppId, 20);
            const coverUrlFromBody = sanitizeText(req.body.coverUrl, 400);

            const existing = await dbGet(
                "SELECT id, game_cover_url FROM recommendations WHERE round_id = ? AND giver_user_id = ? LIMIT 1",
                [roundId, req.session.userId]
            );

            let gameCoverUrl = coverUrlFromBody || "";
            if (req.file) {
                gameCoverUrl = `/uploads/covers/${req.file.filename}`;
            }

            let steamDetails = null;
            if (steamAppId && (!gameName || !gameDescription || !gameCoverUrl)) {
                steamDetails = await getSteamAppDetails(steamAppId);
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

            if (!gameCoverUrl && /^\d+$/.test(steamAppId)) {
                gameCoverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
            }
            if (!gameDescription && steamAppId && gameName) {
                gameDescription = sanitizeText("Descricao curta indisponivel na Steam.", 500);
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

            if (existing) {
                await dbRun(
                    `UPDATE recommendations
                     SET receiver_user_id = ?, game_name = ?, game_cover_url = ?, game_description = ?,
                         reason = ?, steam_app_id = ?, updated_at = ?
                     WHERE id = ?`,
                    [
                        assignment.receiver_user_id,
                        gameName,
                        gameCoverUrl,
                        gameDescription,
                        reason,
                        steamAppId || null,
                        nowInSeconds(),
                        existing.id
                    ]
                );
            } else {
                const now = nowInSeconds();
                await dbRun(
                    `INSERT INTO recommendations
                        (round_id, giver_user_id, receiver_user_id, game_name, game_cover_url, game_description,
                         reason, rating_letter, interest_score, steam_app_id, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                        steamAppId || null,
                        now,
                        now
                    ]
                );
            }

            const payload = await getRoundPayload(roundId, req.session.userId);
            return res.json({ message: "Indicacao salva com sucesso.", round: payload });
        } catch (submitError) {
            console.error(submitError);
            return res.status(500).json({ message: "Erro ao salvar indicacao." });
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
        if (!round || round.status !== "indication") {
            return res.status(400).json({ message: "A rodada nao esta na fase de notas." });
        }
        if (!round.rating_starts_at || nowInSeconds() < round.rating_starts_at) {
            return res.status(400).json({ message: "A sessao de notas ainda nao foi liberada." });
        }

        const recommendation = await dbGet(
            "SELECT id, receiver_user_id FROM recommendations WHERE id = ? AND round_id = ? LIMIT 1",
            [recommendationId, roundId]
        );
        if (!recommendation) {
            return res.status(404).json({ message: "Indicacao nao encontrada para esta rodada." });
        }
        if (recommendation.receiver_user_id !== req.session.userId) {
            return res.status(403).json({ message: "Apenas quem recebeu a indicacao pode dar a nota naval." });
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

        const payload = await getRoundPayload(roundId, req.session.userId);
        return res.json({ message: "Nota naval registrada.", round: payload });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao registrar nota naval." });
    }
});
app.post("/api/recommendations/:recommendationId/comments", requireAuth, async (req, res) => {
    try {
        const recommendationId = Number(req.params.recommendationId);
        const commentText = sanitizeText(req.body.commentText, 500);
        const parentCommentId = Number(req.body.parentCommentId || 0);
        if (!commentText) {
            return res.status(400).json({ message: "Comentario vazio." });
        }

        const recommendation = await dbGet(
            "SELECT id FROM recommendations WHERE id = ? LIMIT 1",
            [recommendationId]
        );
        if (!recommendation) {
            return res.status(404).json({ message: "Indicacao nao encontrada." });
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
                return res.status(400).json({ message: "Comentario pai invalido para esta indicacao." });
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
                    u.id AS user_id, u.username, u.nickname, u.avatar_url
             FROM recommendation_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.id = ? LIMIT 1`,
            [insert.lastID]
        );

        return res.json({ message: "Comentario publicado.", comment: created });
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
            return res.status(400).json({ message: "Comentario vazio." });
        }
        const existing = await dbGet(
            `SELECT id, user_id
             FROM recommendation_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Comentario nao encontrado." });
        }
        if (Number(existing.user_id) !== Number(req.currentUser.id)) {
            return res.status(403).json({ message: "Voce so pode editar seus proprios comentarios." });
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
                    u.id AS user_id, u.username, u.nickname, u.avatar_url
             FROM recommendation_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.id = ? LIMIT 1`,
            [commentId]
        );
        return res.json({ message: "Comentario atualizado.", comment: updated });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao atualizar comentario." });
    }
});

app.delete("/api/recommendation-comments/:commentId", requireAuth, async (req, res) => {
    try {
        const commentId = Number(req.params.commentId);
        const existing = await dbGet(
            `SELECT id, user_id
             FROM recommendation_comments
             WHERE id = ? LIMIT 1`,
            [commentId]
        );
        if (!existing) {
            return res.status(404).json({ message: "Comentario nao encontrado." });
        }
        if (Number(existing.user_id) !== Number(req.currentUser.id)) {
            return res.status(403).json({ message: "Voce so pode excluir seus proprios comentarios." });
        }
        await dbRun(
            `UPDATE recommendation_comments
             SET parent_comment_id = NULL
             WHERE parent_comment_id = ?`,
            [commentId]
        );
        await dbRun("DELETE FROM recommendation_comments WHERE id = ?", [commentId]);
        return res.json({ message: "Comentario removido.", commentId });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao excluir comentario." });
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
            const recommendations = await getRoundRecommendations(round.id);
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
            return res.status(404).json({ message: "Jogo nao encontrado na Steam." });
        }
        return res.json({ item: details });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Erro ao carregar detalhes do jogo." });
    }
});

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

