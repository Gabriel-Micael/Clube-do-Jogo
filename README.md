# Clube do Jogo

Clube do Jogo is a web app where players create recommendation rounds, draw who recommends to whom, submit games, and later rate them on a naval chart (`A-J` + `1-10`).

## Features

- Session-based auth with protected pages
- Email/password registration with verification code
- Password reset via email link
- Google OAuth login
- Profile with avatar, nickname, public profile view, and activity history
- Round workflow: draw -> indication -> rating -> closed
- Draw restrictions (participants that cannot be matched)
- Steam search with selectable game metadata
- Recommendation comments with reply, edit, and delete
- Naval chart with saved round visualization
- Owner/admin permissions for the site owner account

## Stack

- Node.js + Express
- SQLite (`app.db`)
- Session store: `express-session` + `connect-sqlite3` (`sessions.sqlite`)
- Auth/security: `bcryptjs`, `helmet`, `express-rate-limit`, CSP
- File uploads: `multer`
- Email: `nodemailer`
- Frontend: HTML + CSS + vanilla JS

## Project Structure

- `server.js`: backend routes, auth, email, round logic
- `script.js`: frontend app logic
- `style.css`: theme and responsive styles
- `index.html`, `round.html`, `profile.html`, `login.html`, etc.
- `uploads/`: avatars, covers, site assets

## Requirements

- Node.js 18+ (recommended: Node.js 20 LTS)
- npm

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Configure `.env` (minimum):

- `PORT=3000`
- `BASE_URL=http://localhost:3000`
- `SESSION_SECRET=<strong-random-secret>`

4. Start:

```bash
npm start
```

5. Open:

- `http://localhost:3000`

## Environment Variables

Main variables currently used by `server.js`:

- `PORT`: server port
- `BASE_URL`: local/base URL fallback
- `PUBLIC_APP_URL`: preferred public origin (ngrok/domain), used in links and callbacks
- `PUBLIC_BASE_URL`: legacy alias for `PUBLIC_APP_URL`
- `ALLOWED_ORIGINS`: extra allowed origins, comma-separated
- `NODE_ENV`: `development` or `production`
- `SESSION_SECRET`: session encryption secret
- `GOOGLE_ENABLED`: `true|false`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL` (optional fallback)
- `SMTP_ENABLED`: `true|false`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`: `true|false`
- `SMTP_IGNORE_TLS_ERRORS`: `true|false` (development only)
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`: sender name/email (example: `Clube do Jogo <email@domain.com>`)

If your ngrok/public URL changes, update at least:

- `PUBLIC_APP_URL`
- `ALLOWED_ORIGINS`
- Google OAuth authorized redirect URI(s)

## Google OAuth Setup

In Google Cloud Console, configure:

- Authorized JavaScript origins:
  - `http://localhost:3000`
  - your current public URL (example: `https://xxxx.ngrok-free.app`)
- Authorized redirect URIs:
  - `http://localhost:3000/auth/google/callback`
  - `https://xxxx.ngrok-free.app/auth/google/callback`
  - your production callback (`https://clubedojogo.app.br/auth/google/callback`)

Set `.env`:

- `GOOGLE_ENABLED=true`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`

## Email Setup (Gmail Example)

Use an App Password and configure:

- `SMTP_ENABLED=true`
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_SECURE=false`
- `SMTP_USER=your-gmail@gmail.com`
- `SMTP_PASS=<16-char-app-password>`
- `MAIL_FROM="Clube do Jogo <your-gmail@gmail.com>"`

## Deploy (Oracle Linux + Domain)

Minimal flow:

1. Install runtime:
   - Node.js 20 LTS
   - Nginx
2. Copy project to server and run:
   - `npm ci --omit=dev`
   - configure `.env` with production values
3. Run app with a process manager (recommended: PM2).
4. Put Nginx in front as reverse proxy to `127.0.0.1:3000`.
5. Configure HTTPS (Let's Encrypt).
6. Set DNS to your server IP.
7. Keep backups of:
   - `app.db`
   - `sessions.sqlite`
   - `uploads/`

## Security Notes

Already implemented:

- Session cookies
- Security headers via Helmet
- Origin validation for API requests
- Rate limiting on auth flows
- Password hashing with bcrypt
- CSP-compatible frontend behavior

Recommended before public launch:

- Run behind HTTPS only
- Use a strong `SESSION_SECRET`
- Keep dependencies updated
- Restrict file upload limits/types as needed
- Monitor logs and backup database/files

## Ownership / Admin

Owner/admin is identified by email in backend code (`OWNER_EMAIL` in `server.js`).

## License

Private project. Add a license if you plan to publish it publicly.
