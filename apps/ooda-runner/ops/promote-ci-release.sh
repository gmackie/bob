#!/usr/bin/env bash
# Runs as bob over CI's authenticated SSH connection. Existing environment-file
# drop-ins remain in force; only WorkingDirectory and ExecStart are replaced.
set -euo pipefail
sha="$1"
archive="$2"
digest="$3"
[[ "$sha" =~ ^[0-9a-f]{40}$ && "$digest" =~ ^[0-9a-f]{64}$ ]] || exit 2
[[ "$archive" =~ ^/tmp/bob-ooda-ci\.[a-zA-Z0-9]+$ ]] || exit 2
[[ "$(id -un)" == bob ]] || { echo 'Deploy as bob with service-control sudo access' >&2; exit 1; }
export PATH=/home/bob/.local/bin:/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin
node_bin=/home/bob/.local/bin/node
"$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
helper=/usr/local/sbin/bob-ooda-ci-service
sudo -n "$helper" check "$sha"
# Serialize host promotions as well as the workflow's concurrency group.
exec 9>/home/bob/.ooda-runner-ci-deploy.lock
flock -w 1200 9
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --status
release="/opt/bob/releases/ci-ooda-runner-$sha"
scratch="$(mktemp -d)"
staging=""
changed=false
cleanup() {
  status=$?
  trap - EXIT
  if $changed && (( status != 0 )); then
    echo 'Runner verification failed; restoring previous service configuration' >&2
    sudo -n "$helper" rollback "$sha"
  fi
  rm -rf "$scratch"
  [[ -z "$staging" ]] || sudo -n "$helper" discard "$sha"
  exit "$status"
}
trap cleanup EXIT
if [[ ! -d "$release" ]]; then
  staging="$(sudo -n "$helper" prepare "$sha")"
  tar -xzf "$archive" -C "$staging"
  # This file contains a variable reference, never the credential itself.
  printf '%s\n' '//npm.forgegraf.com/:_authToken=${FG_REGISTRY_TOKEN}' > "$scratch/npmrc"
  export NPM_CONFIG_USERCONFIG="$scratch/npmrc"
  (cd "$staging" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile --filter @gmacko/ooda-runner...)
  printf '%s\n' "$sha" > "$staging/.release-sha"
  sudo -n "$helper" publish "$sha"
  staging=""
fi
[[ "$(cat "$release/.release-sha")" == "$sha" ]]
# No registry credentials reach the restarted service.
unset FG_REGISTRY_TOKEN NPM_CONFIG_USERCONFIG
changed=true
sudo -n "$helper" activate "$sha"
for attempt in {1..60}; do
  pid="$(systemctl show -p MainPID --value ooda-runner.service)"
  if systemctl is-active --quiet ooda-runner.service && [[ "$pid" =~ ^[1-9][0-9]*$ ]] &&
    [[ "$(readlink -f "/proc/$pid/cwd")" == "$release/apps/ooda-runner" ]] &&
    tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq "$release/apps/ooda-runner/src/index.ts" &&
    curl --fail --silent --max-time 3 http://127.0.0.1:3010/health | "$node_bin" -e '
      let data=""; process.stdin.on("data", chunk => { data+=chunk; });
      process.stdin.on("end", () => { if (JSON.parse(data).status !== "healthy") process.exit(1); });'; then
    sleep 3
    if [[ "$(systemctl show -p MainPID --value ooda-runner.service)" == "$pid" ]] && systemctl is-active --quiet ooda-runner.service; then
      echo "OODA runner active and healthy at $sha (PID $pid)"
      changed=false
      exit 0
    fi
  fi
  sleep 2
done
echo "Runner did not become healthy at $sha" >&2
exit 1
