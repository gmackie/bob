#!/usr/bin/env bash
# =============================================================================
# verify-trust-slice.sh — fault-injection verifier for Bob production v1.
#
# TRUE TOPOLOGY (do not blur it):
#   - bob-ws-gateway + Postgres live on hetzner-master
#   - ooda-runner (+ supervised agent processes) lives on hetzner-bob
#
# Cut points (design doc step 7):
#   1. runner-kill        — kill ooda-runner on hetzner-bob mid-run
#   2. partition-gateway  — drop runner→gateway traffic (hetzner-bob egress)
#   3. partition-db       — drop gateway→Postgres traffic (hetzner-master, the
#                           2026-07-06 incident class)
#   4. session-expiry     — expire a browser session mid-run
#   5. auth-failure       — force a credential failure termination (the v1
#                           "needs you" terminal signal)
#   6. approval           — trigger a permission request, approve from a
#                           client, verify the run resumes and completes
#   7. lock-contention    — prove deriveAndWriteState's row lock serializes
#                           concurrent writers on REAL Postgres (PGlite in CI
#                           is single-connection and cannot test this)
#   8. cli-probe          — probe the installed claude CLI: does the
#                           configured permission-prompt flag actually emit
#                           control_request on the stream? (version-probed
#                           adapter boundary)
#
# Each check prints PASS/FAIL and the evidence. Manual steps (walking away,
# checking the phone) are prompted explicitly — the verifier never fakes a
# phone. Run from the repo root on a machine with SSH to both boxes:
#
#   ./scripts/verify-trust-slice.sh all
#   ./scripts/verify-trust-slice.sh runner-kill        # one cut point
# =============================================================================

set -uo pipefail

GATEWAY_HOST="${BOB_GATEWAY_HOST:-hetzner-master}"
RUNNER_HOST="${BOB_RUNNER_HOST:-hetzner-bob}"
GATEWAY_PORT="${BOB_GATEWAY_PORT:-3003}"
PG_DSN="${BOB_PG_DSN:-}" # e.g. postgres://...@localhost:5432/bob — used via ssh to GATEWAY_HOST
LEASE_GRACE_S="${BOB_LEASE_GRACE_S:-60}"

pass() { printf '\033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '\033[36m----\033[0m %s\n' "$1"; }
prompt() { printf '\033[33m????\033[0m %s ' "$1"; read -r REPLY; }
FAILURES=0

psql_gateway() {
  # All DB assertions run on the gateway box (Postgres lives there).
  ssh "$GATEWAY_HOST" "psql '${PG_DSN}' -tAc \"$1\""
}

gateway_health() {
  ssh "$GATEWAY_HOST" "curl -sf http://localhost:${GATEWAY_PORT}/health"
}

require_healthy_start() {
  info "Preflight: gateway health + fresh runner lease"
  if ! gateway_health >/dev/null; then
    fail "gateway /health unreachable on ${GATEWAY_HOST}:${GATEWAY_PORT}"
    exit 1
  fi
  local age
  age=$(psql_gateway "select extract(epoch from (now() - max(last_heartbeat_at))) from runner_leases where host_id='${RUNNER_HOST}'")
  if [ -z "$age" ] || [ "${age%%.*}" -gt "$LEASE_GRACE_S" ] 2>/dev/null; then
    fail "runner lease for ${RUNNER_HOST} missing or stale (age=${age:-none}s) — start ooda-runner first"
    exit 1
  fi
  pass "gateway healthy, runner lease fresh (${age%%.*}s)"
}

latest_active_session() {
  psql_gateway "select id from chat_conversations where status in ('running','starting','blocked') order by coalesce(last_activity_at, created_at) desc limit 1"
}

session_status() {
  psql_gateway "select status from chat_conversations where id='$1'"
}

wait_for_status() { # session, expected, timeout_s
  local sid="$1" expected="$2" timeout="$3" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    local st
    st=$(session_status "$sid")
    if [ "$st" = "$expected" ]; then return 0; fi
    sleep 5; waited=$((waited + 5))
  done
  return 1
}

outbox_count() { # session, transition
  psql_gateway "select count(*) from notification_outbox where session_id='$1' and transition='$2'"
}

check_runner_kill() {
  info "CUT 1: runner-kill — SIGKILL ooda-runner mid-run on ${RUNNER_HOST}"
  prompt "Dispatch a real run now (web or phone), then press enter when it is 'running'."
  local sid; sid=$(latest_active_session)
  [ -n "$sid" ] || { fail "no active session found"; return; }
  info "session ${sid}; killing runner (the supervised agent must survive)"
  ssh "$RUNNER_HOST" "pkill -9 -f ooda-runner || true"

  info "waiting past the lease grace (${LEASE_GRACE_S}s) for host_unknown"
  if wait_for_status "$sid" "host_unknown" $((LEASE_GRACE_S + 45)); then
    pass "session moved to host_unknown (never failed) after lease expiry"
  else
    local st; st=$(session_status "$sid")
    if [ "$st" = "failed" ]; then fail "session marked FAILED on silence — false-death regression"; else fail "session is '$st', expected host_unknown"; fi
  fi
  [ "$(outbox_count "$sid" host_unknown)" = "1" ] \
    && pass "exactly one host_unknown outbox row" \
    || fail "host_unknown outbox rows != 1"

  info "restarting the runner — it must ADOPT the live supervised run"
  ssh "$RUNNER_HOST" "systemctl restart ooda-runner || sudo -u bob systemctl --user restart ooda-runner || true"
  if wait_for_status "$sid" "running" 90; then
    pass "run re-adopted: status back to running (corrective path)"
  else
    fail "run not re-adopted within 90s (status=$(session_status "$sid"))"
  fi
  prompt "Did the phone receive 'lost contact' and then a corrective/normal completion later? (y/n)"
  [ "$REPLY" = "y" ] && pass "phone evidence confirmed" || fail "phone evidence missing"
}

check_partition_gateway() {
  info "CUT 2: partition runner→gateway (${RUNNER_HOST} egress to :${GATEWAY_PORT})"
  prompt "Dispatch a run, press enter when running."
  local sid; sid=$(latest_active_session)
  ssh "$RUNNER_HOST" "iptables -A OUTPUT -p tcp --dport ${GATEWAY_PORT} -j DROP"
  info "partition up for 90s — the runner journals events to its disk buffer"
  sleep 90
  ssh "$RUNNER_HOST" "iptables -D OUTPUT -p tcp --dport ${GATEWAY_PORT} -j DROP"
  sleep 20
  local dups
  dups=$(psql_gateway "select count(*) from (select session_id, send_seq, count(*) c from session_events where session_id='${sid}' and send_seq is not null group by 1,2 having count(*)>1) d")
  [ "$dups" = "0" ] && pass "replay produced zero duplicate send-seqs" || fail "${dups} duplicated send-seqs after replay"
  local gaps
  gaps=$(psql_gateway "select count(*) from generate_series(1,(select max(send_seq) from session_events where session_id='${sid}')) s where not exists (select 1 from session_events e where e.session_id='${sid}' and e.send_seq=s)")
  [ "$gaps" = "0" ] && pass "send-seq stream is contiguous (no lost events)" || info "note: ${gaps} send-seq gaps (gap markers from buffer eviction are legitimate — inspect payloads)"
}

check_partition_db() {
  info "CUT 3: partition gateway→Postgres on ${GATEWAY_HOST} (the 2026-07-06 class)"
  ssh "$GATEWAY_HOST" "iptables -A OUTPUT -p tcp --dport 5432 -o lo -j DROP" || {
    info "loopback DROP refused; if Postgres is remote adjust the rule"; }
  info "partition up for 60s — gateway must NOT crash-loop, runner buffers"
  sleep 60
  ssh "$GATEWAY_HOST" "iptables -D OUTPUT -p tcp --dport 5432 -o lo -j DROP" || true
  sleep 10
  if gateway_health >/dev/null; then
    pass "gateway alive after DB partition (no crash loop)"
  else
    fail "gateway dead after DB partition"
  fi
  prompt "Did the dead-man channel page the phone within 5 minutes? (y/n)"
  [ "$REPLY" = "y" ] && pass "dead-man paging confirmed" || fail "dead-man paging missing"
}

check_session_expiry() {
  info "CUT 4: browser session expiry mid-run"
  prompt "In the web app, dispatch a run, then delete the session row: we will expire it server-side. Press enter with a session id ready; paste the browser session token's user id (or just press enter to do it manually)."
  info "manual assertion: after expiry the client reconnect must be rejected with AUTH_FAILED and re-login must resume streaming from lastAckSeq."
  prompt "Did reconnect-after-expiry behave as described? (y/n)"
  [ "$REPLY" = "y" ] && pass "session expiry handled" || fail "session expiry mishandled"
}

check_auth_failure() {
  info "CUT 5: credential-failure termination (v1 'needs you' signal)"
  prompt "On ${RUNNER_HOST}, temporarily break the agent credential (e.g. move ~/.claude credentials for the bob user), dispatch a run, press enter when dispatched."
  local sid; sid=$(latest_active_session)
  if wait_for_status "$sid" "error" 120 || wait_for_status "$sid" "failed" 10; then
    pass "run terminated on auth failure"
  else
    fail "run did not terminate (status=$(session_status "$sid"))"
  fi
  prompt "Did the phone get the failure push naming the auth problem? Restore the credential now. (y/n)"
  [ "$REPLY" = "y" ] && pass "auth-failure push confirmed" || fail "auth-failure push missing"
}

check_approval() {
  info "CUT 6: approval trigger — blocked → approve from phone → resumes"
  prompt "Dispatch a run whose prompt requires a non-allowlisted tool (e.g. 'delete scratch file X with rm'). Press enter when dispatched."
  local sid; sid=$(latest_active_session)
  if wait_for_status "$sid" "blocked" 180; then
    pass "run paused as blocked on the permission request"
  else
    fail "run never blocked (status=$(session_status "$sid")) — check CLAUDE_PERMISSION_PROMPT_ARGS against cli-probe"
    return
  fi
  [ "$(outbox_count "$sid" blocked)" -ge "1" ] && pass "blocked outbox row present" || fail "no blocked outbox row"
  prompt "Approve from the phone banner now. Press enter after approving."
  if wait_for_status "$sid" "running" 60 || wait_for_status "$sid" "completed" 300; then
    pass "run resumed after approval"
  else
    fail "run did not resume (status=$(session_status "$sid"))"
  fi
}

check_lock_contention() {
  info "CUT 7: single-writer row lock on REAL Postgres"
  local sid; sid=$(psql_gateway "select id from chat_conversations order by created_at desc limit 1")
  [ -n "$sid" ] || { fail "no session row to lock"; return; }
  # tx1 takes the row lock and holds it; tx2 must block until timeout.
  local out
  out=$(ssh "$GATEWAY_HOST" "psql '${PG_DSN}' -c \"begin; select status from chat_conversations where id='${sid}' for update; select pg_sleep(3); commit;\" & sleep 0.5; psql '${PG_DSN}' -c \"set statement_timeout='1000'; begin; select status from chat_conversations where id='${sid}' for update; commit;\" 2>&1; wait")
  if echo "$out" | grep -q "canceling statement due to statement timeout"; then
    pass "second writer blocked on the row lock (serialization proven)"
  else
    fail "second writer did NOT block — single-writer guarantee unproven"
  fi
}

check_cli_probe() {
  info "CUT 8: claude CLI permission-flag probe on ${RUNNER_HOST}"
  local args="${CLAUDE_PERMISSION_PROMPT_ARGS:---permission-prompt-tool stdio}"
  local out
  out=$(ssh "$RUNNER_HOST" "cd /tmp && timeout 120 bash -c 'echo \"{\\\"type\\\":\\\"user\\\",\\\"message\\\":{\\\"role\\\":\\\"user\\\",\\\"content\\\":\\\"run: rm -f /tmp/bob-probe-file\\\"}}\" | sudo -u bob claude -p --input-format stream-json --output-format stream-json --verbose ${args} --allowedTools Read 2>&1' | head -50" || true)
  if echo "$out" | grep -q '"type":"control_request"'; then
    pass "CLI emits control_request with args: ${args}"
  else
    fail "CLI did NOT emit control_request — adjust CLAUDE_PERMISSION_PROMPT_ARGS (probe output tail):"
    echo "$out" | tail -5
  fi
}

usage() {
  echo "usage: $0 {all|preflight|runner-kill|partition-gateway|partition-db|session-expiry|auth-failure|approval|lock-contention|cli-probe}"
  exit 2
}

case "${1:-}" in
  all)
    require_healthy_start
    check_cli_probe
    check_lock_contention
    check_approval
    check_runner_kill
    check_partition_gateway
    check_partition_db
    check_auth_failure
    check_session_expiry
    ;;
  preflight) require_healthy_start ;;
  runner-kill) check_runner_kill ;;
  partition-gateway) check_partition_gateway ;;
  partition-db) check_partition_db ;;
  session-expiry) check_session_expiry ;;
  auth-failure) check_auth_failure ;;
  approval) check_approval ;;
  lock-contention) check_lock_contention ;;
  cli-probe) check_cli_probe ;;
  *) usage ;;
esac

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "VERIFIER: all executed checks passed"
else
  echo "VERIFIER: ${FAILURES} check(s) FAILED"
  exit 1
fi
