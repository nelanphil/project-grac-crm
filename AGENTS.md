# AGENTS.md

## Cursor Cloud specific instructions

This is a two-app monorepo (GRAC CRM): an Express + MongoDB API in `server/` and a
Next.js 16 frontend in `client/`. Standard commands live in `README.md` and the
`scripts` blocks of `server/package.json` and `client/package.json`; the notes below
only cover non-obvious caveats for running things in this environment.

### Services and how to run them

- MongoDB (required): the API refuses to boot without it. `mongod` is installed but
  systemd is unavailable, so start it manually, e.g.
  `mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017` (run it in a background/tmux
  session; `/data/db` already exists). Default connection is
  `mongodb://localhost:27017/grac-crm`.
- API (required): `cd server && npm run dev:server` → http://localhost:4009 (nodemon + tsx).
  On boot it connects to Mongo and seeds roles/permissions/contract templates and starts a
  daily cron; this is expected log noise, not errors.
- Client (required): `cd client && npm run dev:client` → http://localhost:3009.
- Health check: `curl http://localhost:4009/health`. Expected: `mongo: "connected"`,
  `mysql: "disconnected"`. `mysql: "disconnected"` is normal — MySQL is legacy/optional and
  is never connected at startup, so do not treat it as a failure.

### Environment variables

- The API loads a repo-root `.env` (gitignored). All values have working dev defaults in
  `server/src/config/env.ts` (Mongo URI, `JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`), so the
  server runs without any `.env`. `client/.env.local` sets `NEXT_PUBLIC_API_URL`
  (defaults to `http://localhost:4009` if absent). The `.env.example` files referenced in
  `README.md` are not committed.

### Initial admin / auth

- Seed the first admin once with `cd server && npx tsx src/scripts/seed-admin.ts`
  (idempotent). It creates `pnelan@gmail.com` / `Digital2` (role `admin`). Log in at
  `/auth/login`.
- `README.md` calls the auth endpoints "stubs" — that is outdated; login/register/
  password-reset are fully implemented in `server/src/routes/auth.routes.ts`.

### Lint / build

- Lint: `npm run lint` in each app. `server` currently reports a few pre-existing lint
  errors in committed source (unrelated to environment setup); `client` lint is clean.
- Optional third-party integrations (Twilio, Stripe/Square/PayPal, Google Maps, SMTP) are
  configured at runtime via the dashboard Control Panel and are not needed to run core flows.
