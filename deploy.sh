#!/usr/bin/env bash
#
# Production deploy helper for the GRAC CRM monorepo.
#
# Pulls the latest code, installs dependencies, builds both apps, and applies
# any pending database migrations against the PRODUCTION database.
#
# Render auto-deploys the client (static) and server (web service) on git push,
# and runs migrations via `preDeployCommand` when on a paid plan. Use this
# script to deploy/migrate manually (e.g. on the free plan, from a Render Shell,
# or from a local machine that can reach the production database).
#
# Usage:
#   ./deploy.sh              # interactive: prompts for confirmation
#   ./deploy.sh --yes        # non-interactive: skip the confirmation prompt
#   ./deploy.sh --skip-pull  # do not run `git pull` (deploy current checkout)
#
set -euo pipefail

# Resolve repo root (the directory this script lives in).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ASSUME_YES=0
SKIP_PULL=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --skip-pull) SKIP_PULL=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "==> GRAC CRM production deploy"
echo "    Repo: $ROOT_DIR"
echo "    Target DB: PRODUCTION (NODE_ENV=production)"
echo

# Guardrail: confirm we really intend to touch production.
if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Type 'production' to continue: " CONFIRM
  if [[ "$CONFIRM" != "production" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

# 1) Pull latest code.
if [[ "$SKIP_PULL" -ne 1 ]]; then
  echo "==> git pull"
  git pull --ff-only
else
  echo "==> Skipping git pull (--skip-pull)"
fi

# 2) Install dependencies.
echo "==> Installing server dependencies"
npm install --prefix server

echo "==> Installing client dependencies"
npm install --prefix client

# 3) Build both apps.
echo "==> Building server (tsc)"
npm run build --prefix server

echo "==> Building client (next build)"
npm run build --prefix client

# 4) Apply pending database migrations against production.
#    Uses the compiled runner (dist/migrations/run.js). Only migrations listed
#    in server/src/migrations/manifest.ts run; dangerous one-off scripts
#    (e.g. copy-dev-to-prod) are never invoked here.
echo "==> Running database migrations (production)"
NODE_ENV=production npm run migrate --prefix server

echo
echo "==> Deploy complete."
