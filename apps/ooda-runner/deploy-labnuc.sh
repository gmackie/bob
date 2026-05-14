#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="/opt/ooda-runner"
REPO_URL="https://git.forgegraf.com/gmacko/bob.git"
BRANCH="${1:-master}"

echo "==> Deploying ooda-runner to $DEPLOY_DIR (branch: $BRANCH)"

if [ ! -d "$DEPLOY_DIR/.git" ]; then
  echo "==> Cloning repo..."
  sudo mkdir -p "$DEPLOY_DIR"
  sudo chown mackieg:users "$DEPLOY_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
else
  echo "==> Pulling latest..."
  cd "$DEPLOY_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

cd "$DEPLOY_DIR"

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile --filter @gmacko/ooda-runner...

echo "==> Setting up storage..."
mkdir -p ~/.ooda/threads

echo "==> Installing systemd service..."
sudo cp apps/ooda-runner/ooda-runner.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ooda-runner
sudo systemctl restart ooda-runner

echo "==> Done. Checking status..."
sleep 2
systemctl status ooda-runner --no-pager
