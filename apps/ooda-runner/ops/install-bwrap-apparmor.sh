#!/usr/bin/env bash
set -euo pipefail
PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

PROFILE_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ooda-bwrap.apparmor"
PROFILE_TARGET="/etc/apparmor.d/ooda-bwrap"
RUNNER_USER="bob"
CONFIRMATION=""

usage() {
  cat <<'USAGE'
Usage: sudo ./install-bwrap-apparmor.sh \
  --runner-user=bob \
  --confirm=ENABLE-OODA-BWRAP:<hostname>

Installs the narrow AppArmor user-namespace grant required by Bubblewrap, then
proves that the runner user can launch a disposable namespace. It refuses to
replace a different existing profile.
USAGE
}

for argument in "$@"; do
  case "$argument" in
    --runner-user=*) RUNNER_USER="${argument#--runner-user=}" ;;
    --confirm=*) CONFIRMATION="${argument#--confirm=}" ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: ${argument}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer through sudo so AppArmor can load the profile" >&2
  exit 2
fi
if ! id "${RUNNER_USER}" >/dev/null 2>&1; then
  echo "Runner user does not exist: ${RUNNER_USER}" >&2
  exit 2
fi

HOST_NAME="$(hostname -s)"
EXPECTED_CONFIRMATION="ENABLE-OODA-BWRAP:${HOST_NAME}"
if [[ "${CONFIRMATION}" != "${EXPECTED_CONFIRMATION}" ]]; then
  echo "Invalid confirmation; expected ${EXPECTED_CONFIRMATION}" >&2
  exit 2
fi
if [[ ! -x /usr/bin/bwrap ]]; then
  echo "Bubblewrap is unavailable at /usr/bin/bwrap" >&2
  exit 1
fi
if [[ ! -x /usr/sbin/apparmor_parser ]]; then
  echo "AppArmor parser is unavailable at /usr/sbin/apparmor_parser" >&2
  exit 1
fi
if [[ -e "${PROFILE_TARGET}" ]] && ! cmp -s "${PROFILE_SOURCE}" "${PROFILE_TARGET}"; then
  echo "Refusing to replace a different ${PROFILE_TARGET}" >&2
  exit 1
fi

/usr/sbin/apparmor_parser --skip-kernel-load --skip-cache "${PROFILE_SOURCE}"
install -m 0644 "${PROFILE_SOURCE}" "${PROFILE_TARGET}"
/usr/sbin/apparmor_parser --replace --skip-cache "${PROFILE_TARGET}"

runuser -u "${RUNNER_USER}" -- /usr/bin/bwrap \
  --die-with-parent \
  --ro-bind /usr /usr \
  --proc /proc \
  --dev /dev \
  -- /usr/bin/true

echo "Bubblewrap AppArmor profile active for ${RUNNER_USER} on ${HOST_NAME}"
