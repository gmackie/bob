#!/usr/bin/env bash
# CI transport: send an exact source archive, never mutate the operator checkout.
set -euo pipefail
sha="${1:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected exact 40-character commit SHA' >&2; exit 2; }
: "${OODA_DEPLOY_TARGET:?Set OODA_DEPLOY_TARGET to user@host}"
: "${FG_REGISTRY_TOKEN:?Private registry token is required}"
[[ "$OODA_DEPLOY_TARGET" =~ ^[a-zA-Z0-9_@.:-]+$ && "$OODA_DEPLOY_TARGET" != -* ]] || exit 2
root="$(git rev-parse --show-toplevel)"
[[ "$(git rev-parse HEAD)" == "$sha" ]] || { echo 'Checkout does not match deployment SHA' >&2; exit 1; }
latest="$(git ls-remote origin refs/heads/master | cut -f1)"
[[ "$latest" == "$sha" ]] || { echo 'Refusing stale runner promotion: master advanced' >&2; exit 1; }
stage="$(mktemp -d)"
remote_archive=""
cleanup() {
  rm -rf "$stage"
  if [[ -n "$remote_archive" ]]; then ssh "$OODA_DEPLOY_TARGET" rm -f "$remote_archive" || true; fi
}
trap cleanup EXIT
# SSH identity and pinned host keys are installed by CI; never accept new keys here.
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
git archive --format=tar.gz "$sha" > "$stage/source.tar.gz"
digest="$(sha256sum "$stage/source.tar.gz" | cut -d ' ' -f1)"
remote_archive="$(ssh "$OODA_DEPLOY_TARGET" mktemp /tmp/bob-ooda-ci.XXXXXXXXXX)"
[[ "$remote_archive" =~ ^/tmp/bob-ooda-ci\.[a-zA-Z0-9]+$ ]] || exit 1
scp "$stage/source.tar.gz" "$OODA_DEPLOY_TARGET:$remote_archive"
# Pass the registry credential on stdin, never in argv or a checked-in file.
{
  printf '%s\n' "$FG_REGISTRY_TOKEN"
  cat "$root/apps/ooda-runner/ops/promote-ci-release.sh"
} | ssh "$OODA_DEPLOY_TARGET" "read -r FG_REGISTRY_TOKEN; export FG_REGISTRY_TOKEN; exec bash -s -- '$sha' '$remote_archive' '$digest'"
