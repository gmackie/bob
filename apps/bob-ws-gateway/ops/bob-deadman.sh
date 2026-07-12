#!/usr/bin/env bash
# Dead-man switch ping for hetzner-master (gateway + Postgres).
#
# Pings $DEADMAN_URL (a healthchecks.io-style check) ONLY when the local
# checks pass. If this box wedges, the gateway crash-loops, or Postgres runs
# out of connection headroom, the ping stops and the dead-man service alerts
# the phone through ITS OWN channel — deliberately independent of Bob's
# gateway and push path, because the 2026-07-06 incident killed the very
# component that sends Bob's pushes.
#
# Install: /opt/bob/ops/bob-deadman.sh + bob-deadman.{service,timer}
# Config:  /opt/bob/ops/deadman.env with DEADMAN_URL=... PG_DSN=...

set -uo pipefail

DEADMAN_URL="${DEADMAN_URL:?DEADMAN_URL is required}"
GATEWAY_PORT="${GATEWAY_PORT:-3003}"
PG_DSN="${PG_DSN:-}"
# Alert when Postgres has fewer free connection slots than this.
MIN_FREE_CONNECTIONS="${MIN_FREE_CONNECTIONS:-50}"

fail() {
  echo "bob-deadman: $1 — withholding ping (dead-man will fire)"
  # Signal the failure reason to the service if it supports /fail.
  curl -fsS -m 10 --retry 2 "${DEADMAN_URL}/fail" --data-raw "$1" >/dev/null 2>&1 || true
  exit 1
}

# 1. Gateway alive and its writer healthy.
health=$(curl -fsS -m 5 "http://127.0.0.1:${GATEWAY_PORT}/health") || fail "gateway /health unreachable"
echo "$health" | grep -q '"status":"ok"' || fail "gateway health not ok"

# 2. Postgres reachable with connection headroom (the 7/06 class).
if [ -n "$PG_DSN" ]; then
  free=$(psql "$PG_DSN" -tAc "select (select setting::int from pg_settings where name='max_connections') - count(*) from pg_stat_activity" 2>/dev/null) \
    || fail "postgres unreachable"
  [ "${free:-0}" -ge "$MIN_FREE_CONNECTIONS" ] || fail "postgres connection headroom low (${free} free)"
fi

curl -fsS -m 10 --retry 3 "$DEADMAN_URL" >/dev/null || echo "bob-deadman: ping delivery failed (network?)"
echo "bob-deadman: ok"
