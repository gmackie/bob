#!/usr/bin/env bash
# Dead-man switch ping for hetzner-bob (ooda-runner).
#
# Pings $DEADMAN_URL only while the runner service is active and its
# gateway connection authenticated recently. Independent of Bob's own push
# path by design — see apps/bob-ws-gateway/ops/bob-deadman.sh.

set -uo pipefail

DEADMAN_URL="${DEADMAN_URL:?DEADMAN_URL is required}"
RUNNER_UNIT="${RUNNER_UNIT:-ooda-runner}"
# The runner logs "[bob-gw] Authenticated" on every (re)connect; silence for
# longer than this without an active unit means it is wedged, not idle.
MAX_LOG_SILENCE_MIN="${MAX_LOG_SILENCE_MIN:-30}"

fail() {
  echo "bob-runner-deadman: $1 — withholding ping"
  curl -fsS -m 10 --retry 2 "${DEADMAN_URL}/fail" --data-raw "$1" >/dev/null 2>&1 || true
  exit 1
}

systemctl is-active --quiet "$RUNNER_UNIT" || fail "unit ${RUNNER_UNIT} not active"

recent=$(journalctl -u "$RUNNER_UNIT" --since "-${MAX_LOG_SILENCE_MIN}m" -n 1 --no-pager -q | wc -l)
if [ "$recent" -eq 0 ]; then
  # No output at all in the window: verify the process is really alive.
  systemctl show -p MainPID --value "$RUNNER_UNIT" | grep -qv '^0$' || fail "runner has no main pid"
fi

curl -fsS -m 10 --retry 3 "$DEADMAN_URL" >/dev/null || echo "bob-runner-deadman: ping delivery failed"
echo "bob-runner-deadman: ok"
