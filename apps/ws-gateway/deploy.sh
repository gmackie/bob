#!/usr/bin/env bash
# Deploy ws-gateway to hetzner-master
#
# Prerequisites:
#   - SSH access to hetzner-master (uses ssh config user, typically root)
#   - /opt/bob/ws-gateway/ directory exists on target
#   - .env file configured on target
#   - systemd service installed: cp bob-ws-gateway.service /etc/systemd/system/
#
# Usage: ./deploy.sh [host] [user]

set -euo pipefail

HOST="${1:-hetzner-master}"
USER="${2:-root}"
SSH_TARGET="${USER}@${HOST}"
REMOTE_DIR="/opt/bob/ws-gateway"
PORT="${WS_GATEWAY_PORT:-3003}"

echo "==> Building ws-gateway..."
cd "$(dirname "$0")"
pnpm build

echo "==> Applying pending DB migrations via SSH tunnel..."
# ws-gateway reads the same Hetzner Postgres as the web app. Apply any
# pending drizzle/*.sql files BEFORE restarting the service, so a new
# build never boots against an older schema.
TUNNEL_PORT="${MIGRATE_TUNNEL_PORT:-15432}"
ssh -fN -o ExitOnForwardFailure=yes -L "${TUNNEL_PORT}:localhost:5432" "${SSH_TARGET}"
TUNNEL_PID=$(pgrep -fn "ssh -fN -o ExitOnForwardFailure=yes -L ${TUNNEL_PORT}:localhost:5432 ${SSH_TARGET}" || true)
cleanup_tunnel() { [ -n "${TUNNEL_PID:-}" ] && kill "${TUNNEL_PID}" 2>/dev/null || true; }
trap cleanup_tunnel EXIT

# Pull the DATABASE_URL from the server's .env and rewrite host:port to the tunnel.
REMOTE_DB_URL=$(ssh "${SSH_TARGET}" "grep '^DATABASE_URL=' ${REMOTE_DIR}/.env | cut -d= -f2- | tr -d '\"'")
if [ -z "${REMOTE_DB_URL}" ]; then
  echo "ERROR: could not read DATABASE_URL from ${REMOTE_DIR}/.env"
  exit 1
fi
# Rewrite any @host:port to @localhost:${TUNNEL_PORT}
LOCAL_DB_URL=$(echo "${REMOTE_DB_URL}" | sed -E "s#@[^/]+#@localhost:${TUNNEL_PORT}#")
DATABASE_URL="${LOCAL_DB_URL}" pnpm -F @bob/db migrate

cleanup_tunnel
trap - EXIT
unset TUNNEL_PID

echo "==> Deploying to ${SSH_TARGET}:${REMOTE_DIR}..."
# Note: 'dist' (no trailing slash) preserves the directory so systemd's
# `node dist/index.js` keeps working.
rsync -avz --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='*.test.ts' \
  --exclude='.turbo' \
  dist package.json \
  "${SSH_TARGET}:${REMOTE_DIR}/"

echo "==> Installing production deps on ${HOST}..."
ssh "${SSH_TARGET}" "cd ${REMOTE_DIR} && npm install --omit=dev"

echo "==> Restarting service..."
ssh "${SSH_TARGET}" "systemctl restart bob-ws-gateway"

echo "==> Checking health on port ${PORT}..."
sleep 2
ssh "${SSH_TARGET}" "curl -sf http://localhost:${PORT}/health | python3 -m json.tool" || {
  echo "WARN: health check failed, checking logs..."
  ssh "${SSH_TARGET}" "journalctl -u bob-ws-gateway -n 20 --no-pager"
  exit 1
}

echo "==> Deploy complete!"
