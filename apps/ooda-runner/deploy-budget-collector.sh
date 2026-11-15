#!/usr/bin/env bash
# BOB-76: build the budget collector into one file and install it on the proxy
# host. Run from the repository root:
#
#   apps/ooda-runner/deploy-budget-collector.sh [host]     # default labnuc
#
# The host needs Node 20+ and /etc/bob-budget-collector/env (0600, see
# docs/ops/budget-collector.md). Each deploy lands in its own release folder
# and `current` is switched atomically, so rolling back is re-pointing it.
set -euo pipefail

HOST="${1:-labnuc}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REV="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || jj -R "$ROOT" log -r @- --no-graph -T 'commit_id.short(12)')"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

ESBUILD="$(ls -d "$ROOT"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | sort -V | tail -1)"
"$ESBUILD" "$ROOT/apps/ooda-runner/src/budget/collector.ts" \
  --bundle --platform=node --target=node20 --format=esm \
  --outfile="$OUT/budget-collector.mjs" --log-level=warning
echo "==> built budget-collector.mjs ($REV)"

RELEASE="/opt/bob-budget-collector/releases/$REV"
scp -q "$OUT/budget-collector.mjs" "$ROOT/apps/ooda-runner/ops/bob-budget-collector.service" "$HOST:/tmp/"
ssh "$HOST" "set -euo pipefail
  sudo install -d -m 0755 '$RELEASE'
  sudo install -m 0644 /tmp/budget-collector.mjs '$RELEASE/budget-collector.mjs'
  sudo ln -sfn '$RELEASE' /opt/bob-budget-collector/current.new
  sudo mv -T /opt/bob-budget-collector/current.new /opt/bob-budget-collector/current
  sudo install -m 0644 /tmp/bob-budget-collector.service /etc/systemd/system/bob-budget-collector.service
  rm -f /tmp/budget-collector.mjs /tmp/bob-budget-collector.service
  sudo systemctl daemon-reload
  sudo systemctl enable bob-budget-collector >/dev/null
  sudo systemctl restart bob-budget-collector
  sleep 3
  systemctl is-active bob-budget-collector
  sudo journalctl -u bob-budget-collector -n 5 --no-pager -o cat"
echo "==> $HOST now runs $RELEASE"
