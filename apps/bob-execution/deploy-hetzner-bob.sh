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

# Copy the whole build dir: the daemon and agent-health share a tsup chunk,
# so copying index.js alone leaves a dangling import at runtime.
cp apps/bob-execution/dist/daemon/*.js "${DEPLOY_STAGE}/dist/daemon/"
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

# The relay keeps ONE daemon per workspace, so starting this service while
# ooda-runner holds that slot evicts it — taking the credential surface and
# dispatch control down with it. ooda-runner is the daemon on hetzner-bob, so
# refuse rather than fight it for the socket. Deploying the files (including
# the agent-health CLI, which the task runner's circuit breaker shells out to)
# is always safe; only starting the service is not.
echo "==> Checking whether another daemon holds the workspace slot..."
if ssh "${SSH_TARGET}" "systemctl is-active --quiet ooda-runner.service" 2>/dev/null; then
  echo "    ooda-runner is active on ${HOST} and owns the gateway daemon slot."
  echo "    Files deployed; NOT starting bob-execution (it would evict ooda-runner)."
  echo "    To hand the slot over deliberately: stop ooda-runner first."
  echo "==> Deploy complete (files only)!"
  exit 0
fi

echo "==> Checking for .env..."
if ssh "${SSH_TARGET}" "test -f ${REMOTE_DIR}/.env"; then
  echo "    .env exists, restarting service..."
  ssh "${SSH_TARGET}" "systemctl enable bob-execution && systemctl restart bob-execution"
  sleep 2
  ssh "${SSH_TARGET}" "journalctl -u bob-execution -n 10 --no-pager"
  echo "==> Verifying service-user provider readiness..."
  node "${REPO_ROOT}/scripts/verify-bob-provider-host.mjs" "${HOST}" "${USER}" || true
else
  echo "    WARNING: No .env file at ${REMOTE_DIR}/.env"
  echo "    Create it with:"
  echo "      BOB_API_KEY=<api-key>"
  echo "      BOB_WORKSPACE_ID=<workspace-id>"
  echo "      GATEWAY_WS_URL=ws://100.101.32.120:3003/sessions"
  echo "      BOB_DEV_DIR=/home/bob/dev"
  echo "    Authenticate locally as bob: claude auth login; codex login; grok login --device-auth; cursor-agent login"
  echo "    Then: systemctl enable bob-execution && systemctl start bob-execution"
fi

echo "==> Deploy complete!"
