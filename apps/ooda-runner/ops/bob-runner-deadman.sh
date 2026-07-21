#!/usr/bin/env bash
# Dead-man switch ping for hetzner-bob (ooda-runner).
#
# Pings $DEADMAN_URL only while the runner service is active and its
# gateway connection authenticated recently. Independent of Bob's own push
# path by design — see apps/bob-ws-gateway/ops/bob-deadman.sh.

set -uo pipefail

DEADMAN_URL="${DEADMAN_URL:?DEADMAN_URL is required}"
RUNNER_UNIT="${RUNNER_UNIT:-ooda-runner}"
# Window over which we look for a gateway reconnect/auth-failure LOOP.
CHURN_WINDOW_MIN="${CHURN_WINDOW_MIN:-30}"
# A healthy runner authenticates once and stays connected — it logs ZERO
# reconnect/error events while idle. This many churn events in the window means
# it is wedged in a reconnect/auth-failure loop (e.g. rejected credentials),
# NOT idle. Counting any journal line (the old check) treated that loop's own
# error spew as proof of health.
MAX_RECONNECT_CHURN="${MAX_RECONNECT_CHURN:-5}"

fail() {
  echo "bob-runner-deadman: $1 — withholding ping"
  curl -fsS -m 10 --retry 2 "${DEADMAN_URL}/fail" --data-raw "$1" >/dev/null 2>&1 || true
  exit 1
}

systemctl is-active --quiet "$RUNNER_UNIT" || fail "unit ${RUNNER_UNIT} not active"

systemctl show -p MainPID --value "$RUNNER_UNIT" | grep -qv '^0$' || fail "runner has no main pid"

# Detect a reconnect/auth-failure loop: the runner logs these markers only when
# its gateway connection is failing. A steady authenticated connection logs none.
churn=$(journalctl -u "$RUNNER_UNIT" --since "-${CHURN_WINDOW_MIN}m" --no-pager -q 2>/dev/null \
  | grep -cE '\[bob-gw\] (Disconnected, reconnecting|Server error|WebSocket error|No hello_ok)' || true)
if [ "${churn:-0}" -ge "$MAX_RECONNECT_CHURN" ]; then
  fail "gateway connection churn (${churn} reconnect/error events in ${CHURN_WINDOW_MIN}m) — likely auth failure or wedge"
fi

curl -fsS -m 10 --retry 3 "$DEADMAN_URL" >/dev/null || echo "bob-runner-deadman: ping delivery failed"
echo "bob-runner-deadman: ok"
