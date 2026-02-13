# Clube do Jogo

Clube do Jogo is a web app where a group of players creates rounds, gets random recommendation pairs, sends game recommendations, and later rates games on a naval chart (letter + score).

## Main Features

- Email/password authentication with session-based access control
- Email verification on signup
- Password reset by email link
- Google login support
- Profile page with avatar, nickname, and activity history
- Round lifecycle: draft, reveal, indication, rating, closed
- Random assignment rotation to reduce repeated pairings
- Steam search integration for game suggestions
- Recommendation feed with comments, replies, edit, and delete
- Admin controls for the owner account

## Tech Stack

- Backend: Node.js, Express
- Database: SQLite (`app.db`)
- Sessions: `express-session` + `connect-sqlite3` (`sessions.sqlite`)
- Auth/Security: bcrypt, helmet, rate limiting
- File uploads: multer
- Mail: nodemailer
- Frontend: HTML, CSS, vanilla JavaScript

## Project Structure

- `server.js`: API and server-side logic
- `script.js`: client-side logic
- `style.css`: UI styles
- `index.html`, `round.html`, `profile.html`, `login.html`, etc.: pages
- `uploads/`: user content and site assets

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Configure required values in `.env`:

- `PORT`
- `BASE_URL` (for local: `http://localhost:3000`)
- `SESSION_SECRET`
- SMTP settings (if real email sending is required)
- Google OAuth settings (if Google login is required)

4. Run:

```bash
npm start
```

5. Open:

- `http://localhost:3000`

## Production Notes

- Use `NODE_ENV=production`
- Set `BASE_URL` to your public HTTPS domain
- Configure reverse proxy (Nginx) and TLS certificates
- Keep backups of:
  - `app.db`
  - `sessions.sqlite`
  - `uploads/`

## Ownership / Admin

The owner account is identified by email in the backend (`OWNER_EMAIL` in `server.js`).

## License

Private project. Add a license if you plan to publish publicly.
