#!/usr/bin/env bash
set -euo pipefail

# Predeploy hook for the bob.blder.bot Cloudflare Worker.
#
# Applies any pending @bob/db forward SQL migrations to the production Postgres
# before `vinext deploy` ships the worker. CF Workers reach the DB via
# Hyperdrive at runtime; migrations run directly over Tailscale.
#
# Connection string resolution (first hit wins):
#   1. $DATABASE_URL (explicit override — CI, manual runs)
#   2. `forge db url --app <APP>`            (authoritative, current credential)
#   3. `forge secret get DATABASE_URL_LOCAL` (stored Tailscale-direct secret)
#
# The migration runner (packages/bob/src/db/src/migrate.ts) is forward-only,
# idempotent, and advisory-locked, so re-running against an up-to-date DB is a
# safe no-op ("No pending migrations").

STAGE="${MIGRATE_STAGE:-production}"
APP="${MIGRATE_APP:-bob}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FG="${FG_BIN:-$HOME/.forgegraph/bin/fg}"

DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -x "$FG" ]; then
  DB_URL="$("$FG" db url --app "$APP" 2>/dev/null || true)"
  if [ -z "$DB_URL" ]; then
    DB_URL="$("$FG" secret get DATABASE_URL_LOCAL --stage "$STAGE" 2>/dev/null || true)"
  fi
fi

if [ -z "$DB_URL" ]; then
  echo "migrate-hetzner: could not resolve a database URL." >&2
  echo "  Set DATABASE_URL, or ensure '$FG db url --app $APP' resolves." >&2
  exit 1
fi

cd "$REPO_ROOT"
DATABASE_URL="$DB_URL" pnpm -F @bob/db migrate
