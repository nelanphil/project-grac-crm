# GRAC CRM

Monorepo-style CRM application with a Next.js frontend and Express API backend.

## Stack

- **Client:** Next.js (App Router), TypeScript, Tailwind CSS, Zustand
- **Server:** Express, TypeScript, Mongoose (MongoDB), mysql2 (MySQL)

## Database split

- **MongoDB** — flexible CRM documents (leads, notes)
- **MySQL** — relational data (users, accounts, permissions), managed via phpMyAdmin

## Prerequisites

- Node.js 18+
- MongoDB running locally
- MySQL running locally with phpMyAdmin (optional, for schema management)

## Setup

Run the client and server in **separate terminals** from their own folders.

### 1. Server

```bash
cd server
npm install
cp ../.env.example .env
# Edit .env with your database credentials
npm run dev:server
```

Server runs at `http://localhost:4009` (nodemon reloads on file changes).

### 2. MySQL schema

1. Create a database named `grac_crm` in MySQL/phpMyAdmin
2. Import `server/src/db/mysql/schema.sql` via phpMyAdmin

### 3. Client

```bash
cd client
npm install
cp .env.local.example .env.local
npm run dev:client
```

Client runs at `http://localhost:3009`.

## Dev scripts

| Command | Location | Description |
|---------|----------|-------------|
| `npm run dev:server` | `server/` | Start API (port 4009, nodemon) |
| `npm run dev:client` | `client/` | Start frontend (port 3009) |
| `npm run dev` | `server/` or `client/` | Alias for the script in that folder |
| `npm run build` | `server/` or `client/` | Build that project |

## Environment variables

Repo-root `.env` is loaded by the API (`server/src/config/env.ts`).

| Variable | Location | Description |
|----------|----------|-------------|
| `PORT` | `.env` | API port (default 4009) |
| `CLIENT_URL` | `.env` | Frontend URL for CORS and password-reset links |
| `MONGODB_URI_DEVELOPMENT` / `MONGODB_URI_PRODUCTION` | `.env` | MongoDB connection strings |
| `MYSQL_*` | `.env` | MySQL connection settings |
| `SMTP_HOST` | `.env` | Optional SMTP fallback host |
| `SMTP_PORT` | `.env` | SMTP port (default `587`) |
| `SMTP_USER` | `.env` | Optional SMTP fallback username |
| `SMTP_PASS` | `.env` | Optional SMTP fallback password |
| `SMTP_SECURE` | `.env` | Set `true` for port 465 TLS |
| `EMAIL_FROM` | `.env` | Optional From address for env fallback |
| `NEXT_PUBLIC_API_URL` | `client/.env.local` | Backend API URL |

**Outbound email** is configured in the dashboard **Control Panel → Email**. Assign the **General notifications** role for password-reset and signup confirmation emails (and **Billing notifications** for future invoice mail). Env `SMTP_*` vars are a last-resort fallback when no matching account is assigned. In non-production, forgot-password may return a `devResetUrl` if mail cannot be sent.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with DB status |
| POST | `/auth/login` | Auth stub (not implemented) |
| POST | `/auth/register` | Auth stub (not implemented) |
