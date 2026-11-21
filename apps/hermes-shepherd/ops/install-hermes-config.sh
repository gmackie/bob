#!/usr/bin/env bash
# Deliver the versioned Hermes config and its health check to hetzner-bob (BOB-108).
#
#   sudo apps/hermes-shepherd/ops/install-hermes-config.sh --check   # read-only drift report
#   sudo apps/hermes-shepherd/ops/install-hermes-config.sh           # install
#
# Installs, from this checkout:
#   hermes-config/config.yaml                          -> /home/bob/.hermes/config.yaml
#   hermes-config/profiles/hermes-console/config.yaml  -> /home/bob/.hermes/profiles/hermes-console/config.yaml
#   hermes-config/profiles/hermes-operator/config.yaml -> /home/bob/.hermes/profiles/hermes-operator/config.yaml
#   hermes-config/job-models.json                      -> provider/model pins on the daily cron jobs
#   ops/hermes-health-check.py + hermes-daily-canary.{service,timer}
#
# A config file is replaced only when it differs; the live file is backed up to
# <file>.bak-<UTC stamp> first, and only then is hermes-gateway restarted. No
# other service is touched. Secrets stay in the untracked /home/bob/.hermes/.env.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "install-hermes-config.sh must run as root" >&2
  exit 1
fi

CHECK=0
case "${1:-}" in
  "") ;;
  --check) CHECK=1 ;;
  *) echo "usage: $0 [--check]" >&2; exit 64 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHEPHERD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_SRC="${SHEPHERD_DIR}/hermes-config"
HERMES_DIR="/home/bob/.hermes"
HERMES_PYTHON="${HERMES_DIR}/hermes-agent/venv/bin/python"
OPS_DIR="/opt/bob/ops"
UNIT_DIR="/etc/systemd/system"
STAMP="$(date -u +%Y%m%dT%H%MZ)"

# Relative to both CONFIG_SRC and HERMES_DIR.
CONFIGS=(
  "config.yaml"
  "profiles/hermes-console/config.yaml"
  "profiles/hermes-operator/config.yaml"
)

drift=0
changed=0

for rel in "${CONFIGS[@]}"; do
  src="${CONFIG_SRC}/${rel}"
  dst="${HERMES_DIR}/${rel}"
  if [[ -f "${dst}" ]] && cmp -s "${src}" "${dst}"; then
    echo "config ${rel}: unchanged"
    continue
  fi
  drift=1
  if [[ "${CHECK}" -eq 1 ]]; then
    echo "config ${rel}: DRIFT"
    # Hunk headers only (e.g. "2c2"): never echo live values, which may be sensitive.
    [[ -f "${dst}" ]] && { diff "${dst}" "${src}" | grep -E '^[0-9]' | sed 's/^/  changed lines /'; } || true
    continue
  fi
  if [[ -f "${dst}" ]]; then
    cp -p "${dst}" "${dst}.bak-${STAMP}"
    echo "config ${rel}: backed up to ${rel}.bak-${STAMP}"
  fi
  install -d -o bob -g bob -m 0700 "$(dirname "${dst}")"
  install -o bob -g bob -m 0600 "${src}" "${dst}"
  echo "config ${rel}: installed"
  changed=1
done

job_args=("${CONFIG_SRC}/job-models.json")
[[ "${CHECK}" -eq 1 ]] && job_args+=("--check")
if ! sudo -u bob env HOME=/home/bob HERMES_HOME="${HERMES_DIR}" PYTHONPATH="${HERMES_DIR}/hermes-agent" \
  "${HERMES_PYTHON}" "${SCRIPT_DIR}/apply-hermes-job-models.py" "${job_args[@]}"; then
  drift=1
fi

ops_drift() {
  local src="$1" dst="$2"
  if [[ -f "${dst}" ]] && cmp -s "${src}" "${dst}"; then
    echo "ops ${dst}: unchanged"
  else
    echo "ops ${dst}: DRIFT"
    drift=1
  fi
}

if [[ "${CHECK}" -eq 1 ]]; then
  ops_drift "${SCRIPT_DIR}/hermes-health-check.py" "${OPS_DIR}/hermes-health-check.py"
  ops_drift "${SCRIPT_DIR}/hermes-daily-canary.service" "${UNIT_DIR}/hermes-daily-canary.service"
  ops_drift "${SCRIPT_DIR}/hermes-daily-canary.timer" "${UNIT_DIR}/hermes-daily-canary.timer"
  systemctl is-enabled --quiet hermes-daily-canary.timer || { echo "timer hermes-daily-canary.timer: not enabled"; drift=1; }
  [[ "${drift}" -eq 0 ]] && echo "hermes config: in sync" || echo "hermes config: DRIFT"
  exit "${drift}"
fi

install -d -o root -g root -m 0755 "${OPS_DIR}"
install -o root -g root -m 0755 "${SCRIPT_DIR}/hermes-health-check.py" "${OPS_DIR}/hermes-health-check.py"
install -o root -g root -m 0644 "${SCRIPT_DIR}/hermes-daily-canary.service" "${UNIT_DIR}/hermes-daily-canary.service"
install -o root -g root -m 0644 "${SCRIPT_DIR}/hermes-daily-canary.timer" "${UNIT_DIR}/hermes-daily-canary.timer"
# Superseded by hermes-health-check.py (the old canary only logged to the journal).
rm -f "${OPS_DIR}/hermes-daily-canary.sh"
systemctl daemon-reload
systemctl enable --now hermes-daily-canary.timer

if [[ "${changed}" -eq 1 ]]; then
  systemctl restart hermes-gateway.service
  echo "hermes-gateway.service restarted for the new config"
fi

# Prove the delivered state matches the checkout.
exec "${BASH_SOURCE[0]}" --check
