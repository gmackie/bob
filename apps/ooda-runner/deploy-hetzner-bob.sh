#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${OODA_DEPLOY_HOST:-hetzner-bob}"
DEPLOY_USER="${OODA_DEPLOY_USER:-bob}"
DEPLOY_DIR="${OODA_DEPLOY_DIR:-/home/bob/dev/gmacko-bob}"
DEPLOY_BRANCH="${OODA_DEPLOY_BRANCH:-master}"

usage() {
  echo "Usage: $0 --sha=<40-hex> --confirm=DEPLOY-OODA-RUNNER:<40-hex>"
}

DEPLOY_SHA=""
DEPLOY_CONFIRMATION=""
for argument in "$@"; do
  case "$argument" in
    --sha=*) DEPLOY_SHA="${argument#--sha=}" ;;
    --confirm=*) DEPLOY_CONFIRMATION="${argument#--confirm=}" ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $argument" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "--sha must be an exact lowercase 40-character Git SHA" >&2
  exit 2
fi
if [[ "$DEPLOY_CONFIRMATION" != "DEPLOY-OODA-RUNNER:${DEPLOY_SHA}" ]]; then
  echo "Invalid confirmation for ${DEPLOY_SHA}" >&2
  exit 2
fi

echo "Promoting OODA runner ${DEPLOY_SHA} on ${DEPLOY_HOST}"

ssh "$DEPLOY_HOST" sudo -u "$DEPLOY_USER" bash -s -- \
  "$DEPLOY_DIR" "$DEPLOY_BRANCH" "$DEPLOY_SHA" <<'REMOTE_SCRIPT'
set -euo pipefail

deploy_dir="$1"
deploy_branch="$2"
deploy_sha="$3"

require_node_24() {
  local runtime_label="$1"
  local node_binary="$2"
  local node_version
  local node_major

  node_version="$("$node_binary" --version)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 24 )); then
    echo "Refusing deployment: ${runtime_label} resolved ${node_version}; Node 24+ is required" >&2
    exit 1
  fi
  echo "${runtime_label} resolved ${node_version}"
}

cd "$deploy_dir"

if [[ -n "$(git status --short --untracked-files=no)" ]]; then
  echo "Refusing deployment: live checkout has tracked changes" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

git fetch --prune origin "$deploy_branch"
remote_sha="$(git rev-parse "origin/${deploy_branch}")"
current_sha="$(git rev-parse HEAD)"

if [[ "$remote_sha" != "$deploy_sha" ]]; then
  echo "Refusing deployment: origin/${deploy_branch} is ${remote_sha}, expected ${deploy_sha}" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$current_sha" "$deploy_sha"; then
  echo "Refusing deployment: ${deploy_sha} is not a fast-forward from ${current_sha}" >&2
  exit 1
fi

git merge --ff-only "$deploy_sha"

export PATH="/nix/var/nix/profiles/default/bin:/home/bob/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
require_node_24 "deploy toolchain" "node"
pnpm install --frozen-lockfile --filter @gmacko/ooda-runner...
pnpm --filter @gmacko/ooda-runner typecheck
pnpm --filter @gmacko/ooda-runner test
pnpm --filter @gmacko/ooda-runner build
REMOTE_SCRIPT

ssh "$DEPLOY_HOST" sudo bash -s -- "$DEPLOY_DIR" <<'REMOTE_SERVICE'
set -euo pipefail

deploy_dir="$1"

require_node_24() {
  local runtime_label="$1"
  local node_binary="$2"
  local node_version
  local node_major

  node_version="$("$node_binary" --version)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 24 )); then
    echo "Refusing deployment: ${runtime_label} resolved ${node_version}; Node 24+ is required" >&2
    exit 1
  fi
  echo "${runtime_label} resolved ${node_version}"
}

install -D -m 0644 \
  "${deploy_dir}/apps/ooda-runner/ops/ooda-runner-node24.conf" \
  /etc/systemd/system/ooda-runner.service.d/20-node24.conf
systemctl daemon-reload
systemctl restart ooda-runner.service

for _ in {1..30}; do
  if systemctl is-active --quiet ooda-runner.service; then
    main_pid="$(systemctl show -p MainPID --value ooda-runner.service)"
    if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]]; then
      require_node_24 "active service" "/proc/${main_pid}/exe"
      exit 0
    fi
  fi
  sleep 1
done

echo "OODA runner did not start with Node 24+" >&2
journalctl -u ooda-runner.service -n 100 --no-pager >&2
exit 1
REMOTE_SERVICE

for _ in {1..30}; do
  if ssh "$DEPLOY_HOST" systemctl is-active --quiet ooda-runner.service; then
    active_sha="$(
      ssh "$DEPLOY_HOST" sudo -u "$DEPLOY_USER" \
        git -C "$DEPLOY_DIR" rev-parse HEAD
    )"
    if [[ "$active_sha" == "$DEPLOY_SHA" ]]; then
      echo "OODA runner active at ${active_sha}"
      exit 0
    fi
  fi
  sleep 1
done

echo "OODA runner did not become active at ${DEPLOY_SHA}" >&2
ssh "$DEPLOY_HOST" sudo journalctl -u ooda-runner.service -n 100 --no-pager >&2
exit 1
