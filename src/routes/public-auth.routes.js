module.exports = function registerPublicAuthRoutes(app, deps) {
const {
    assertNicknameAvailable,
    baseUrl,
    bcrypt,
    createToken,
    createVerificationCode,
    dbGet,
    dbRun,
    express,
    fs,
    generateAvailableNickname,
    generateAvailableUsername,
    getGoogleCallbackUrl,
    getRequestOrigin,
    googleEnabled,
    isOwnerEmail,
    isValidEmail,
    normalizeNickname,
    nowInSeconds,
    parseOrigin,
    passport,
    path,
    port,
    publicAppUrl,
    publicDir,
    sanitizeText,
    sendVerificationEmail,
    session,
    uploadRoot,
} = deps;

app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/favicon.ico", (req, res) => {
    const faviconPath = path.join(uploadRoot, "site-logo-min.png");
    if (fs.existsSync(faviconPath)) {
        return res.sendFile(faviconPath);
    }
    return res.status(204).end();
});

app.use(express.static(publicDir, { index: false }));

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
            return res.status(400).json({ message: "Nome de usuário inválido." });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: "Email inválido." });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: "A senha precisa ter ao menos 8 caracteres." });
        }

        const existingUser = await dbGet(
            "SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1",
            [email, username]
        );
        if (existingUser) {
            return res.status(409).json({ message: "Email ou nome de usuário já cadastrados." });
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
        return res.json({ message: "Código enviado para o email informado." });
    } catch (error) {
        console.error(error);
        if (/nickname j[aá]/i.test(String(error.message || ""))) {
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
            return res.status(404).json({ message: "Cadastro pendente não encontrado." });
        }
        if (pending.expires_at < nowInSeconds()) {
            await dbRun("DELETE FROM pending_registrations WHERE email = ?", [email]);
            return res.status(400).json({ message: "Código expirado. Faça o cadastro novamente." });
        }

        const validCode = await bcrypt.compare(code, pending.code_hash);
        if (!validCode) {
            return res.status(400).json({ message: "Código inválido." });
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
        if (/nickname j[aá]/i.test(String(error.message || ""))) {
            return res.status(409).json({ message: error.message });
        }
        if (String(error.message || "").includes("UNIQUE")) {
            return res.status(409).json({ message: "Conta já confirmada para este email/usuário." });
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
            return res.status(401).json({ message: "Email ou senha inválidos." });
        }
        if (!user.email_verified) {
            return res.status(403).json({ message: "Email ainda não confirmado." });
        }
        if (Number(user.blocked) === 1) {
            return res.status(403).json({ message: "Conta bloqueada. Contate o dono do site." });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ message: "Email ou senha inválidos." });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.isOwner = isOwnerEmail(user.email);
        return req.session.save((sessionError) => {
            if (sessionError) {
                console.error(sessionError);
                return res.status(500).json({ message: "Erro ao criar sessão." });
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
};
