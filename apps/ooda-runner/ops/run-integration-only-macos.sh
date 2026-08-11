#!/bin/zsh
set -euo pipefail

runner_root="${OODA_INTEGRATION_RUNNER_ROOT:-$HOME/.local/share/ooda-integration-runner/current}"
keychain_service="${OODA_KEYCHAIN_SERVICE:-com.gmacko.ooda.integration-runner}"
keychain_account="${OODA_KEYCHAIN_ACCOUNT:-$USER}"
tsx_bin="$runner_root/apps/ooda-runner/node_modules/.bin/tsx"
entrypoint="$runner_root/apps/ooda-runner/src/integration-only.ts"

if [[ ! -x "$tsx_bin" || ! -f "$entrypoint" ]]; then
  print -u2 "OODA integration runner release is incomplete: $runner_root"
  exit 1
fi

runner_secret="$(/usr/bin/security find-generic-password \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -w)"
if [[ -z "$runner_secret" ]]; then
  print -u2 "OODA integration runner secret is empty"
  exit 1
fi

export OODA_RUNNER_SECRET="$runner_secret"
unset runner_secret

cd "$runner_root/apps/ooda-runner"
exec "$tsx_bin" src/integration-only.ts
