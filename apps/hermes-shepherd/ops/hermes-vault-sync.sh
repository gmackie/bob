#!/usr/bin/env bash
set -euo pipefail

vault="${HERMES_VAULT_PATH:-/home/bob/hermes-workspace/obsidian}"
lock="${HERMES_VAULT_SYNC_LOCK:-/run/hermes-vault-sync/sync.lock}"

exec 9>"$lock"
flock -n 9 || exit 0

cd "$vault"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Hermes vault sync refused: checkout is dirty" | systemd-cat -t hermes-vault-sync -p err
  exit 1
fi

git fetch origin master
git pull --ff-only origin master
git push origin master
