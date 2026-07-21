#!/usr/bin/env bash
set -euo pipefail

# rotate-bob-db-password.sh
# -----------------------------------------------------------------------------
# One-step rotation + reconciliation of the production `bob` Postgres role
# across EVERY active consumer. Run this instead of a bare `forge db
# rotate-password`, which only updates the forge secrets and leaves the worker
# (Hyperdrive) and the systemd services on stale credentials.
#
# Consumers reconciled (see docs / memory: project_bob-db-credential-topology):
#   1. forge secrets DATABASE_URL / DATABASE_URL_LOCAL   (forge db rotate-password)
#   2. Cloudflare Hyperdrive origin password — CF Worker  (wrangler hyperdrive update)
#   3. bob-ws-gateway on hetzner-master                   (/opt/bob/ws-gateway/.env, localhost)
#   4. hetzner-bob node services                          (/opt/bob-gmacko/.env [runtime-mirror+gmacko],
#                                                          /opt/bob-nextjs/.env [nextjs])
#
# Each node consumer is TESTED (the new password is verified against that
# consumer's own DB host) BEFORE its .env is rewritten, so a bad credential
# never takes a service down. Every edited .env is backed up to .env.bak.rotate.
#
# Usage:
#   scripts/rotate-bob-db-password.sh             # rotate the role, then reconcile all consumers
#   scripts/rotate-bob-db-password.sh --no-rotate # reconcile using the CURRENT forge secret (no ALTER ROLE)
#   scripts/rotate-bob-db-password.sh --dry-run   # test the current password against every consumer; change nothing
#
# Requirements: forge CLI (~/.forgegraph/bin/fg) with `node exec` access to
# hetzner-master + hetzner-bob; wrangler authed to the Cloudflare account; psql
# present on each node. Assumes forge-generated hex passwords (regex/sed-safe).
# -----------------------------------------------------------------------------

FG="${FG_BIN:-$HOME/.forgegraph/bin/fg}"
APP="${BOB_APP:-bob}"
STAGE="${BOB_STAGE:-production}"
HYPERDRIVE_ID="${BOB_HYPERDRIVE_ID:-c1f467f772dc4ce99d99e572df74c121}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ROTATE=1
DRY_RUN=0
case "${1:-}" in
  --no-rotate) ROTATE=0 ;;
  --dry-run)   ROTATE=0; DRY_RUN=1 ;;
  "" )         ;;
  *) echo "unknown flag: $1 (use --no-rotate or --dry-run)" >&2; exit 2 ;;
esac

# Consumer map: "node|envfile|service1 service2 ..."
CONSUMERS=(
  "hetzner-master|/opt/bob/ws-gateway/.env|bob-ws-gateway.service"
  "hetzner-bob|/opt/bob-gmacko/.env|bob-runtime-mirror.service bob-gmacko.service"
  "hetzner-bob|/opt/bob-nextjs/.env|bob-nextjs.service"
)

log(){ printf '\n=== %s ===\n' "$*"; }

command -v "$FG" >/dev/null 2>&1 || { echo "forge CLI not found at $FG" >&2; exit 1; }

# 1. Rotate the role (ALTER ROLE on master + update forge secrets)
if [ "$ROTATE" = 1 ]; then
  log "Rotating bob role password (forge db rotate-password)"
  "$FG" db rotate-password --app "$APP" --no-env >/dev/null
  echo "  rotated; forge DATABASE_URL/DATABASE_URL_LOCAL secrets updated"
else
  echo "  ($([ "$DRY_RUN" = 1 ] && echo dry-run || echo no-rotate): using CURRENT forge secret, no ALTER ROLE)"
fi

# 2. Resolve the target password from the stored secret
NEWURL="$("$FG" secret get DATABASE_URL --stage "$STAGE")"
NEWPW="$(printf '%s' "$NEWURL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
[ "${#NEWPW}" -ge 16 ] || { echo "ERROR: could not resolve DATABASE_URL password from forge" >&2; exit 1; }
echo "  target password sha=$(printf '%s' "$NEWPW" | shasum | cut -c1-12) len=${#NEWPW}"

# 3. Cloudflare Hyperdrive (CF Worker runtime path)
log "Cloudflare Hyperdrive origin password ($HYPERDRIVE_ID)"
if [ "$DRY_RUN" = 1 ]; then
  echo "  [dry-run] would: wrangler hyperdrive update $HYPERDRIVE_ID --origin-password <new>"
else
  ( cd "$REPO_ROOT/apps/bob" && pnpm exec wrangler hyperdrive update "$HYPERDRIVE_ID" --origin-password "$NEWPW" >/dev/null )
  echo "  hyperdrive updated"
fi

# 4. Reconcile each node consumer (test -> swap password -> restart -> verify)
MODE=apply; [ "$DRY_RUN" = 1 ] && MODE=test
FAILED=()
for entry in "${CONSUMERS[@]}"; do
  IFS='|' read -r node envfile services <<<"$entry"
  log "$node : $envfile ($services)"
  if ! "$FG" node exec '
      f="'"$envfile"'"; svcs="'"$services"'"; npw="'"$NEWPW"'"; mode="'"$MODE"'"
      [ -f "$f" ] || { echo "  MISSING $f (skipped)"; exit 0; }
      # candidate = existing line with the password swapped (host/user/db preserved)
      cand=$(grep "^DATABASE_URL=" "$f" | head -1 | sed -E "s#(://[^:@]+:)[^@]+(@)#\1${npw}\2#; s/^DATABASE_URL=//; s/^\"//; s/\"$//")
      if ! psql "$cand" -tAc "SELECT 1" >/dev/null 2>&1; then
        echo "  AUTH FAILED against this consumer'\''s DB host — not modifying $f"; exit 1
      fi
      if [ "$mode" = test ]; then echo "  [dry-run] auth OK; would rewrite $f + restart: $svcs"; exit 0; fi
      cp "$f" "$f.bak.rotate"
      sed -i -E "/^DATABASE_URL=/ s#(://[^:@]+:)[^@]+(@)#\1${npw}\2#" "$f"
      systemctl restart $svcs
      sleep 3
      ok=1
      for s in $svcs; do st=$(systemctl is-active "$s"); echo "  $s: $st"; [ "$st" = active ] || ok=0; done
      [ "$ok" = 1 ] && echo "  reconciled OK" || { echo "  WARNING: a service is not active after restart"; exit 1; }
    ' --node "$node"; then
    FAILED+=("$node:$envfile")
  fi
done

# 5. Verify the public surface (read-only)
log "Public endpoints"
printf '  bob.blder.bot/api/health = %s\n' "$(curl -sS -m 15 -o /dev/null -w '%{http_code}' https://bob.blder.bot/api/health || echo ERR)"
printf '  ws.blder.bot/health      = %s\n' "$(curl -sS -m 15 -o /dev/null -w '%{http_code}' https://ws.blder.bot/health || echo ERR)"

echo
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "COMPLETED WITH FAILURES on: ${FAILED[*]}"
  echo "Re-run with --no-rotate to retry reconciliation once the cause is fixed."
  exit 1
fi
echo "Done — $([ "$DRY_RUN" = 1 ] && echo 'dry-run: all consumers authenticate with the current password' || echo 'rotation + reconciliation complete')."
