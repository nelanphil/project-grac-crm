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

| Variable | Location | Description |
|----------|----------|-------------|
| `PORT` | server/.env | API port (default 4009) |
| `CLIENT_URL` | server/.env | Frontend URL for CORS |
| `MONGODB_URI` | server/.env | MongoDB connection string |
| `MYSQL_*` | server/.env | MySQL connection settings |
| `NEXT_PUBLIC_API_URL` | client/.env.local | Backend API URL |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with DB status |
| POST | `/auth/login` | Auth stub (not implemented) |
| POST | `/auth/register` | Auth stub (not implemented) |
