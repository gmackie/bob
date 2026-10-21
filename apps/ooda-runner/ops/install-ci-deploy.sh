#!/usr/bin/env bash
# One-time administrator setup. Run from a reviewed checkout of this change.
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run this installer as root' >&2; exit 1; }
ops="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
visudo -cf "$ops/bob-ooda-ci.sudoers"
install -o root -g root -m 0755 "$ops/bob-ooda-ci-service" /usr/local/sbin/bob-ooda-ci-service
install -o root -g root -m 0440 "$ops/bob-ooda-ci.sudoers" /etc/sudoers.d/bob-ooda-ci
runuser -u bob -- sudo -n /usr/local/sbin/bob-ooda-ci-service check 0000000000000000000000000000000000000000
echo 'OODA runner CI service promotion configured'
