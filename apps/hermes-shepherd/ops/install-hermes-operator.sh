#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "install-hermes-operator.sh must run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHEPHERD_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HERMES_DIR="/home/bob/.hermes"
PLUGIN_DIR="${HERMES_DIR}/plugins/hermes-operator"
SCRIPTS_DIR="${HERMES_DIR}/scripts"
HERMES_CLI="${HERMES_DIR}/hermes-agent/venv/bin/hermes"
HERMES_ENV="${HERMES_DIR}/.env"

for name in HERMES_BOB_OPERATOR_URL HERMES_BOB_OPERATOR_API_KEY; do
  if ! sudo -u bob grep -Eq "^${name}=.+" "${HERMES_ENV}"; then
    echo "${name} must already be configured in ${HERMES_ENV}" >&2
    exit 1
  fi
done

# Non-secret usage-journal location for the privacy-safe hermes_usage producer.
if ! sudo -u bob grep -Eq "^HERMES_OPERATOR_USAGE_JOURNAL=.+" "${HERMES_ENV}"; then
  echo "HERMES_OPERATOR_USAGE_JOURNAL=/home/bob/.local/state/skillfleet-workflows/bob.jsonl" \
    | sudo -u bob tee -a "${HERMES_ENV}" >/dev/null
fi

install -d -o bob -g bob -m 0750 "${PLUGIN_DIR}" "${SCRIPTS_DIR}"
install -o bob -g bob -m 0644 \
  "${SHEPHERD_DIR}/plugins/hermes-operator/plugin.yaml" \
  "${PLUGIN_DIR}/plugin.yaml"
install -o bob -g bob -m 0644 \
  "${SHEPHERD_DIR}/plugins/hermes-operator/__init__.py" \
  "${PLUGIN_DIR}/__init__.py"
install -o bob -g bob -m 0755 \
  "${SCRIPT_DIR}/reconcile-hermes-operator.py" \
  "${PLUGIN_DIR}/reconcile-hermes-operator.py"
install -o bob -g bob -m 0755 \
  "${SCRIPT_DIR}/hermes-operator-job.py" \
  "${SCRIPTS_DIR}/hermes-operator-today.py"
install -o bob -g bob -m 0755 \
  "${SCRIPT_DIR}/hermes-operator-job.py" \
  "${SCRIPTS_DIR}/hermes-operator-close.py"
install -o bob -g bob -m 0755 \
  "${SCRIPT_DIR}/hermes-operator-send.py" \
  "${SCRIPTS_DIR}/hermes-operator-morning-send.py"
install -o bob -g bob -m 0755 \
  "${SCRIPT_DIR}/hermes-operator-send.py" \
  "${SCRIPTS_DIR}/hermes-operator-close-send.py"

install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/hermes-operator-reconcile.service" \
  /etc/systemd/system/hermes-operator-reconcile.service
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/hermes-operator-reconcile.timer" \
  /etc/systemd/system/hermes-operator-reconcile.timer

sudo -u bob "${HERMES_CLI}" plugins doctor hermes-operator --ci
sudo -u bob "${HERMES_CLI}" plugins enable hermes-operator --no-allow-tool-override
systemctl daemon-reload
systemctl restart hermes-gateway.service
systemctl enable --now hermes-operator-reconcile.timer
systemctl start hermes-operator-reconcile.service
