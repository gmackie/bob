#!/usr/bin/env bash
# Apply pending SQL migrations to the Hetzner Postgres used by blder.bot.
#
# Opens an SSH tunnel to hetzner-master, reads DATABASE_URL from the
# ws-gateway server .env, rewrites the host to the tunnel, and runs
# pnpm -F @bob/db migrate. Idempotent — safe to run from any deploy
# script as a pre-step.
#
# For production schema drift where the SQL migration files are missing from
# this checkout, pass --push to run drizzle-kit push through the same tunnel.
#
# Usage:
#   ./scripts/migrate-hetzner.sh                 # apply
#   ./scripts/migrate-hetzner.sh --dry-run       # preview pending SQL files
#   ./scripts/migrate-hetzner.sh --push          # reconcile schema drift
#   HOST=... USER=... ./scripts/migrate-hetzner.sh

set -euo pipefail

# Note: don't use $USER as a variable name — shell pre-sets it to the
# current login user, which breaks the ${VAR:-default} idiom.
HOST="${HETZNER_HOST:-hetzner-master}"
SSH_USER="${HETZNER_SSH_USER:-root}"
SSH_TARGET="${SSH_USER}@${HOST}"
REMOTE_ENV="${REMOTE_ENV:-/opt/bob/ws-gateway/.env}"
TUNNEL_PORT="${MIGRATE_TUNNEL_PORT:-15432}"
MODE="${1:-}"

# Resolve repo root so this works from any cwd
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Opening SSH tunnel ${TUNNEL_PORT}:localhost:5432 to ${SSH_TARGET}..."
ssh -fN -o ExitOnForwardFailure=yes -L "${TUNNEL_PORT}:localhost:5432" "${SSH_TARGET}"
TUNNEL_PID=$(pgrep -fn "ssh -fN -o ExitOnForwardFailure=yes -L ${TUNNEL_PORT}:localhost:5432 ${SSH_TARGET}" || true)
cleanup() { [ -n "${TUNNEL_PID:-}" ] && kill "${TUNNEL_PID}" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Reading DATABASE_URL from ${SSH_TARGET}:${REMOTE_ENV}..."
# REMOTE_ENV is interpolated server-side; guard against shell metacharacters
# by validating it locally before sending.
if ! [[ "${REMOTE_ENV}" =~ ^[A-Za-z0-9_./-]+$ ]]; then
  echo "ERROR: REMOTE_ENV contains unsafe characters: ${REMOTE_ENV}"
  exit 1
fi
REMOTE_DB_URL=$(ssh "${SSH_TARGET}" "grep '^DATABASE_URL=' ${REMOTE_ENV} | cut -d= -f2- | tr -d '\"'")
if [ -z "${REMOTE_DB_URL}" ]; then
  echo "ERROR: DATABASE_URL not found in ${REMOTE_ENV}"
  exit 1
fi
LOCAL_DB_URL=$(echo "${REMOTE_DB_URL}" | sed -E "s#@[^/]+#@localhost:${TUNNEL_PORT}#")

case "${MODE}" in
  "")
    echo "==> Running migrate..."
    DATABASE_URL="${LOCAL_DB_URL}" pnpm --dir "${REPO_ROOT}" -F @bob/db migrate
    ;;
  "--dry-run")
    echo "==> Running migrate:dry..."
    DATABASE_URL="${LOCAL_DB_URL}" pnpm --dir "${REPO_ROOT}" -F @bob/db migrate:dry
    ;;
  "--push")
    echo "==> Running drizzle-kit push..."
    DATABASE_URL="${LOCAL_DB_URL}" pnpm --dir "${REPO_ROOT}" -F @bob/db exec drizzle-kit push --force
    ;;
  *)
    echo "ERROR: unknown mode: ${MODE}"
    echo "Usage: $0 [--dry-run|--push]"
    exit 1
    ;;
esac
