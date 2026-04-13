#!/usr/bin/env bash
# Deploy ws-gateway to hetzner-master
#
# Prerequisites:
#   - SSH access to hetzner-master as bob user
#   - /opt/bob/ws-gateway/ directory exists on target
#   - .env file configured on target
#   - systemd service installed: sudo cp bob-ws-gateway.service /etc/systemd/system/
#
# Usage: ./deploy.sh [host]

set -euo pipefail

HOST="${1:-hetzner-master}"
REMOTE_DIR="/opt/bob/ws-gateway"

echo "==> Building ws-gateway..."
cd "$(dirname "$0")"
pnpm build

echo "==> Deploying to ${HOST}:${REMOTE_DIR}..."
rsync -avz --delete \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='src' \
  --exclude='*.test.ts' \
  --exclude='.turbo' \
  dist/ package.json \
  "bob@${HOST}:${REMOTE_DIR}/"

echo "==> Installing production deps on ${HOST}..."
ssh "bob@${HOST}" "cd ${REMOTE_DIR} && npm install --omit=dev"

echo "==> Restarting service..."
ssh "bob@${HOST}" "sudo systemctl restart bob-ws-gateway"

echo "==> Checking health..."
sleep 2
ssh "bob@${HOST}" "curl -sf http://localhost:3002/health | python3 -m json.tool" || {
  echo "WARN: health check failed, checking logs..."
  ssh "bob@${HOST}" "journalctl -u bob-ws-gateway -n 20 --no-pager"
  exit 1
}

echo "==> Deploy complete!"
