#!/usr/bin/env bash
set -euo pipefail

vault="${HERMES_VAULT_PATH:-/home/bob/hermes-workspace/obsidian}"
today="$(TZ=America/Los_Angeles date +%F)"
note="$vault/Daily/${today}.md"

if [[ ! -s "$note" ]]; then
  echo "Hermes daily briefing missing after cutoff: Daily/${today}.md" | systemd-cat -t hermes-daily-canary -p alert
  exit 1
fi

echo "Hermes daily briefing present: Daily/${today}.md" | systemd-cat -t hermes-daily-canary -p info
