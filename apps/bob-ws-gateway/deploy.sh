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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "==> Building ws-gateway..."
cd "${SCRIPT_DIR}"
pnpm build

# Boot smoke test — BEFORE anything touches production. A bad ESM bundle (e.g. a
# dependency doing a dynamic require() the ESM output can't resolve) crashes at
# module init and would crash-loop the service on restart. Since deploy.sh does
# an rsync --delete with no auto-rollback, catch it here instead. Run the bundle
# with a dummy DB + ephemeral port for a few seconds and fail if it dies with a
# module-initialization error (it's fine for it to fail later on the DB connect).
echo "==> Smoke-testing that the built bundle boots..."
SMOKE_OUT="$(DATABASE_URL="postgres://smoke:smoke@127.0.0.1:1/smoke" WS_GATEWAY_PORT=0 \
  timeout 8 node dist/index.js 2>&1 || true)"
if echo "${SMOKE_OUT}" | grep -qiE "Dynamic require of|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|SyntaxError|is not supported"; then
  echo "ERROR: gateway bundle fails to initialize — aborting BEFORE touching production." >&2
  echo "${SMOKE_OUT}" | grep -iE "Dynamic require of|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|SyntaxError|is not supported" | head -3 >&2
  exit 1
fi
echo "==> Bundle boots clean."

echo "==> Applying pending DB migrations..."
HETZNER_HOST="${HOST}" HETZNER_SSH_USER="${USER}" \
  "${REPO_ROOT}/scripts/migrate-hetzner.sh"

echo "==> Producing deployable tree via pnpm deploy..."
# pnpm deploy writes a self-contained directory with workspace: deps
# resolved and node_modules installed. Overwrites on each run.
DEPLOY_STAGE="${REPO_ROOT}/.deploy/ws-gateway"
rm -rf "${DEPLOY_STAGE}"
pnpm --filter @bob/ws-gateway deploy --legacy --prod "${DEPLOY_STAGE}"

echo "==> Deploying to ${SSH_TARGET}:${REMOTE_DIR}..."
# pnpm deploy's stage does NOT reliably contain dist/ (it stages package
# sources + node_modules); an rsync that lists "${DEPLOY_STAGE}/dist" exits 23
# and aborts the script BEFORE the restart, leaving the box on old code with a
# half-updated node_modules (the 2026-07-06 deploy quirk). Ship dist from the
# just-built package directory instead, as its own step.
rsync -avz --delete \
  --exclude='.env' \
  --exclude='*.test.ts' \
  --exclude='.turbo' \
  "${DEPLOY_STAGE}/node_modules" \
  "${DEPLOY_STAGE}/package.json" \
  "${SSH_TARGET}:${REMOTE_DIR}/"
rsync -avz --delete \
  "${SCRIPT_DIR}/dist" \
  "${SSH_TARGET}:${REMOTE_DIR}/"

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
