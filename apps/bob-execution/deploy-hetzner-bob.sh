#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-hetzner-bob}"
USER="${2:-root}"
SSH_TARGET="${USER}@${HOST}"
REMOTE_DIR="/opt/bob/execution-daemon"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "==> Building execution daemon..."
cd "${REPO_ROOT}"
pnpm --filter @bob/execution run build:daemon

echo "==> Preparing deploy bundle..."
DEPLOY_STAGE="${REPO_ROOT}/.deploy/execution-daemon"
rm -rf "${DEPLOY_STAGE}"
mkdir -p "${DEPLOY_STAGE}/dist/daemon"

cp apps/bob-execution/dist/daemon/index.js "${DEPLOY_STAGE}/dist/daemon/"
cp apps/bob-execution/bob-execution.service "${DEPLOY_STAGE}/"

cat > "${DEPLOY_STAGE}/package.json" << 'PKGJSON'
{
  "name": "bob-execution-daemon",
  "private": true,
  "type": "module",
  "dependencies": {
    "ws": "^8.18.0"
  }
}
PKGJSON

cd "${DEPLOY_STAGE}"
npm install --omit=dev 2>&1 | tail -5

echo "==> Deploying to ${SSH_TARGET}:${REMOTE_DIR}..."
ssh "${SSH_TARGET}" "mkdir -p ${REMOTE_DIR}"
rsync -avz --delete \
  --exclude='.env' \
  "${DEPLOY_STAGE}/dist" \
  "${DEPLOY_STAGE}/node_modules" \
  "${DEPLOY_STAGE}/package.json" \
  "${SSH_TARGET}:${REMOTE_DIR}/"

echo "==> Installing systemd service..."
ssh "${SSH_TARGET}" "cp ${REMOTE_DIR}/bob-execution.service /etc/systemd/system/ 2>/dev/null || true"
scp "${DEPLOY_STAGE}/bob-execution.service" "${SSH_TARGET}:/etc/systemd/system/"
ssh "${SSH_TARGET}" "systemctl daemon-reload"

echo "==> Checking for .env..."
if ssh "${SSH_TARGET}" "test -f ${REMOTE_DIR}/.env"; then
  echo "    .env exists, restarting service..."
  ssh "${SSH_TARGET}" "systemctl enable bob-execution && systemctl restart bob-execution"
  sleep 2
  ssh "${SSH_TARGET}" "journalctl -u bob-execution -n 10 --no-pager"
else
  echo "    WARNING: No .env file at ${REMOTE_DIR}/.env"
  echo "    Create it with:"
  echo "      BOB_API_KEY=<api-key>"
  echo "      BOB_WORKSPACE_ID=<workspace-id>"
  echo "      GATEWAY_WS_URL=ws://100.101.32.120:3003/sessions"
  echo "      ANTHROPIC_API_KEY=<key>"
  echo "      BOB_DEV_DIR=/home/bob/dev"
  echo "    Then: systemctl enable bob-execution && systemctl start bob-execution"
fi

echo "==> Deploy complete!"
