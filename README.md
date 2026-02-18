# Clube do Jogo

Plataforma web para rodadas de indicação de jogos, com sorteio entre participantes, fase de indicação, fase de notas navais e histórico social (comentários, curtidas e perfil).

Produção atual: `https://clubedojogo.app.br`  
Servidor da aplicação: Node.js/Express com SQLite (pode rodar localmente na sua máquina e publicar com proxy reverso).

## Stack

- Backend: Node.js + Express (`server.js`)
- Banco: SQLite (`database.sqlite`)
- Sessão: `express-session` + `connect-sqlite3`
- Auth: email/senha + Google OAuth (`passport-google-oauth20`)
- Uploads: `multer` (avatar/capas)
- Segurança: `helmet`, `express-rate-limit`
- E-mail transacional: `nodemailer`
- Frontend: HTML + CSS + JavaScript puro (`public/`)
- Realtime: SSE (`EventSource`) para atualização por evento (sem polling periódico no cliente)

## Principais Features

- Cadastro com verificação por código no e-mail.
- Login por e-mail/senha e login com Google.
- Redefinição de senha (perfil e “esqueci minha senha”).
- Perfil com avatar, nickname, conquistas e histórico de atividade.
- Comentários em recomendações e no perfil com:
  - responder
  - editar
  - excluir
  - curtir
  - lista de curtidas
- Fluxo da rodada:
  - `draft` (sorteio/participantes/restrições)
  - `reveal` (revelação dos pares)
  - `indication` (indicações)
  - `rating` (notas navais)
  - `closed` (encerrada)
  - `reopened` (rodada reaberta para edição/finalização)
- Plano Naval (grade X/Y com miniaturas e pilha por coordenada).
- Painel administrativo com dono e moderadores:
  - gestão de usuários
  - gestão de rodadas
  - gestão de conquistas
  - solicitações pendentes (fluxo de aprovação do dono para ações de moderador)
  - sugestões enviadas pelos usuários
- Conquistas por participação e por critérios de gênero/atributos.
- Metadados de jogos:
  - Steam (busca e detalhes)
  - RAWG (fallback/principal para entrada manual por nome)
  - crédito da RAWG exibido na UI conforme termos.

## Realtime (100% por evento no cliente)

- O frontend não usa `setInterval` para atualizar home/rodada/conquistas.
- Atualizações chegam por SSE:
  - `/api/admin/events` para estado do painel administrativo.
  - `/api/rounds/events` para mudanças de rodada/recomendação/comentários/notas.
- O backend emite eventos quando há mutação relevante (ex.: reabrir rodada, salvar indicação, comentar, curtir comentário, fechar rodada, etc.).

## Estrutura de Pastas

```text
.
|-- server.js
|-- database.sqlite
|-- package.json
|-- README.md
|-- public/
|   |-- index.html
|   |-- login.html
|   |-- register.html
|   |-- verify-email.html
|   |-- forgot-password.html
|   |-- reset-password.html
|   |-- profile.html
|   |-- round.html
|   |-- admin.html
|   |-- script.js
|   |-- style.css
|   `-- demo/
|-- uploads/
|   |-- avatars/
|   |-- covers/
|   `-- trofeus/
`-- .env.example
```

## Variáveis de Ambiente

Use `.env.example` como base.

Campos importantes:

- App e domínio:
  - `PORT`, `HOST`, `NODE_ENV`
  - `BASE_URL`
  - `PUBLIC_APP_URL`
  - `ALLOWED_ORIGINS`
- Proxy reverso:
  - `TRUST_PROXY=1` em produção atrás de Caddy/Nginx.
- Cookies de sessão:
  - `SESSION_SECRET`
  - `SESSION_COOKIE_SECURE`
  - `SESSION_COOKIE_SAMESITE`
  - `SESSION_COOKIE_DOMAIN`
- OAuth Google:
  - `GOOGLE_ENABLED`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_CALLBACK_URL`
- RAWG:
  - `RAWG_API_KEY`
- SMTP:
  - `SMTP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`

## Rodando Localmente

1. Instalar dependências:

```bash
npm install
```

2. Criar `.env`:

```bash
cp .env.example .env
```

3. Ajustar variáveis mínimas (`PORT`, `BASE_URL`, `SESSION_SECRET`).

4. Iniciar:

```bash
npm start
```

5. Abrir:

`http://localhost:3000`

## Produção no domínio clubedojogo.app.br (sem tunnel)

1. Rodar a app localmente (ex.: `127.0.0.1:3000`).
2. Configurar proxy reverso (Caddy/Nginx) para `clubedojogo.app.br`.
3. Apontar DNS para seu IP público.
4. Configurar encaminhamento de portas 80/443 no roteador para a máquina do proxy.
5. Em produção, usar:
  - `TRUST_PROXY=1`
  - `SESSION_COOKIE_SECURE=true`
  - `SESSION_COOKIE_DOMAIN=clubedojogo.app.br`

## Observações Técnicas

- A aplicação normaliza artefatos de codificação no frontend para evitar textos quebrados de legado.
- Recomendações e conquistas usam sincronização no backend; notificações visuais de desbloqueio são disparadas no cliente.
- Rodadas reabertas não devem ser tratadas como rodada “nova”; elas entram em fluxo específico de edição/finalização.

