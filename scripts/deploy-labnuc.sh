#!/bin/bash
set -euo pipefail

HOST="labnuc.tail1e1a32.ts.net"
DIR="/home/mackieg/dev/bob"
NVM="source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1"

echo "==> Deploying Bob to $HOST"

echo "==> Pulling latest code..."
ssh "$HOST" "cd $DIR && git pull"

echo "==> Installing dependencies..."
ssh "$HOST" "bash -c '$NVM && cd $DIR && pnpm install --frozen-lockfile 2>/dev/null || pnpm install'"

echo "==> Pushing schema..."
ssh "$HOST" "bash -c '$NVM && cd $DIR && pnpm --filter @bob/db push'"

echo "==> Building web app..."
ssh "$HOST" "bash -c '$NVM && cd $DIR && SKIP_ENV_VALIDATION=1 pnpm --filter @bob/web build'"

echo "==> Restarting services..."
ssh "$HOST" "systemctl --user restart bob-web bob-gateway"

echo "==> Waiting for services..."
sleep 5

echo "==> Checking health..."
STATUS=$(ssh "$HOST" "curl -sk -o /dev/null -w '%{http_code}' https://labnuc.tail1e1a32.ts.net:9443/planning")
if [ "$STATUS" = "200" ]; then
  echo "==> Deploy successful! Bob is live at https://labnuc.tail1e1a32.ts.net:9443"
else
  echo "==> Warning: health check returned $STATUS"
  ssh "$HOST" "systemctl --user status bob-web bob-gateway 2>&1 | head -20"
fi
