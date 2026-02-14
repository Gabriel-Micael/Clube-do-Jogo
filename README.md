# Clube do Jogo

Clube do Jogo is a web app for game recommendation rounds: users draw pairs, recommend games, and later rate them on a naval chart (A-J + 1-10).

## Project Structure

```text
project/
|-- server.js
|-- database.sqlite
|-- package.json
|-- public/
|   |-- index.html
|   |-- login.html
|   |-- register.html
|   |-- verify-email.html
|   |-- forgot-password.html
|   |-- reset-password.html
|   |-- profile.html
|   |-- round.html
|   |-- script.js
|   |-- style.css
|   `-- demo/
|       |-- index.html
|       |-- demo.css
|       |-- demo.js
|       |-- demo_looping.mp4
|       `-- screenshots/
|           |-- login.jpg
|           |-- home.jpg
|           |-- home2.jpg
|           |-- home3.jpg
|           |-- sorteio.jpg
|           |-- sorteio2.jpg
|           |-- sorteio3.jpg
|           |-- indicacao1.jpg
|           |-- indicacao2.jpg
|           |-- indicacao3.jpg
|           |-- indicacao4.jpg
|           |-- indicacao5.jpg
|           |-- notanaval1.jpg
|           |-- notanaval2.jpg
|           `-- perfil.jpg
|-- screenshots/
|   |-- login.jpg
|   |-- home.jpg
|   |-- home2.jpg
|   |-- home3.jpg
|   |-- sorteio.jpg
|   |-- sorteio2.jpg
|   |-- sorteio3.jpg
|   |-- notanaval1.jpg
|   |-- notanaval2.jpg
|   `-- perfil.jpg
|-- .github/
|   `-- workflows/
|       `-- deploy-demo-pages.yml
`-- README.md
```

Other operational files also exist in the repository (for local run and deployment), such as `.env`, `.env.example`, `uploads/`, `sessions.sqlite`, `app.db`, and `node_modules/`.

## Main Features

- Session auth with protected pages
- Email/password signup with verification
- Password reset by email link
- Google OAuth login
- Profile (avatar, nickname, history)
- Round flow: draw -> indication -> rating -> closed
- Draw restrictions (who cannot be paired)
- Steam search for game suggestions
- Comments with reply/edit/delete
- Naval chart with round history

## Stack

- Node.js + Express
- SQLite (`database.sqlite`)
- `express-session` + `connect-sqlite3`
- `bcryptjs`, `helmet`, `express-rate-limit`
- `multer` and `nodemailer`
- HTML/CSS/Vanilla JS frontend in `public/`

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Configure at least:

- `PORT=3000`
- `BASE_URL=http://localhost:3000`
- `SESSION_SECRET=<strong-secret>`

4. Start app:

```bash
npm start
```

5. Open `http://localhost:3000`.