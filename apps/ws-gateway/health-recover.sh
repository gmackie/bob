#!/usr/bin/env bash
set -u

SERVICE_NAME="${BOB_GATEWAY_SERVICE_NAME:-bob-ws-gateway.service}"
APP_DIR="${BOB_GATEWAY_APP_DIR:-/opt/bob/ws-gateway}"
PREVIOUS_DIR="${BOB_GATEWAY_PREVIOUS_DIR:-${APP_DIR}.previous}"
PORT="${GATEWAY_PORT:-3002}"
HEALTH_URL="${BOB_GATEWAY_HEALTH_URL:-http://127.0.0.1:${PORT}/health}"
TIMEOUT_SECONDS="${BOB_GATEWAY_HEALTH_TIMEOUT_SECONDS:-30}"
MARKER_FILE="/run/bob-ws-gateway-health-recovering"

deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  if curl -fsS --max-time 2 "${HEALTH_URL}" >/dev/null; then
    exit 0
  fi
  sleep 1
done

echo "Health probe failed for ${HEALTH_URL} after ${TIMEOUT_SECONDS}s"

if [[ ! -d "${PREVIOUS_DIR}" ]]; then
  echo "No previous deployment found at ${PREVIOUS_DIR}; leaving current deployment in place"
  exit 0
fi

if [[ -e "${MARKER_FILE}" ]]; then
  echo "Recovery already in progress; skipping nested rollback"
  exit 0
fi

if ! touch "${MARKER_FILE}" 2>/dev/null; then
  echo "Could not create recovery marker ${MARKER_FILE}; skipping rollback"
  exit 0
fi
trap 'rm -f "${MARKER_FILE}"' EXIT

echo "Reverting ${APP_DIR} from ${PREVIOUS_DIR}"
rsync -a --delete --exclude='.env' "${PREVIOUS_DIR}/" "${APP_DIR}/"
systemctl restart --no-block "${SERVICE_NAME}" || true
