# Bob Production Runbook

One page for the solo operator. Topology first, because getting it wrong has
burned us: **bob-ws-gateway + Postgres run on `hetzner-master`; ooda-runner
(and the supervised agent processes) run on `hetzner-bob`; the web app is a
Cloudflare Worker at `bob.blder.bot`.**

## Deploys (single command each)

| What | Command | Notes |
|---|---|---|
| Gateway | `apps/bob-ws-gateway/deploy.sh` | Builds, **runs migrations first**, ships dist + node_modules, restarts, health-checks. Targets `hetzner-master`. |
| Runner | tsx checkout on `hetzner-bob` (user `bob`) | `git pull && systemctl restart ooda-runner`. Runs from source via tsx — `supervisor-wrapper.cjs` ships with the source tree. |
| Web | wrangler deploy (existing CF pipeline) | |
| Mobile | Preflight local iOS build | Native build needed for push-config changes (not OTA). |

**Migration-first deploy order is mandatory** for schema changes: the
`agent_run_status` enum gained `blocked` and `host_unknown` — code that
writes those values against an unmigrated database throws. deploy.sh already
orders migrate → ship → restart; do not bypass it.

**Runner deploys do NOT kill in-flight runs.** Agents run under detached
supervisor wrappers; a graceful runner stop leaves them alive and the next
runner generation adopts them (pidfile + token verification). If you must
truly kill a run, do it from the UI (cancel) or `kill` the wrapper's child.

## The trust machinery (what pages you, and why)

- **Bob pushes** (outbox → Expo): run blocked / failed / interrupted /
  completed / host_unknown. Sent by the gateway; if the gateway is the thing
  that died, these cannot save you — that is what the dead-man is for.
- **Dead-man switch** (healthchecks.io-style, both boxes, every minute,
  independent channel to the phone):
  - `hetzner-master`: withholds its ping when gateway `/health` fails or
    Postgres has <50 free connection slots (the 2026-07-06 class).
  - `hetzner-bob`: withholds when the runner unit is down/wedged.
  - Install: copy `apps/*/ops/bob-*deadman*` to `/opt/bob/ops/`, create
    `/opt/bob/ops/deadman.env` with `DEADMAN_URL` (+ `PG_DSN` on master).
    On master also set `GATEWAY_PORT=3002` **if the gateway unit overrides the
    default port** — the script defaults to 3002 to match
    `bob-ws-gateway.service`; a mismatch health-checks a dead socket and fires
    constantly. Then `systemctl enable --now bob-deadman.timer` (master) /
    `bob-runner-deadman.timer` (bob).
  - **Monthly test-fire (do not skip):** stop the timer for one interval,
    confirm the phone alert arrives, start it again. The alerting service
    dying silently is the one failure nothing else catches.

## Tunables (live, no redeploy)

`gateway_config` (single row):
- `leaseGraceMs` (60s) — read live by the lease sweep; the false-alarm vs
  silent-death dial. Tune it during the 10-run experiment.
- `eventRetentionDays` (30) — read live by the outbox retention cron (~hourly);
  output chunks of terminal runs older than this are pruned, lifecycle events
  are kept forever.
- `heartbeatIntervalMs` (15s) — RESERVED, not yet wired. The gateway currently
  uses a hardcoded 30s WS heartbeat; changing this row has no effect today.

## Deploy order (hard requirement)

Migrate, then deploy the gateway, then the runner:
1. **Migrate as `postgres`, not `bob`.** The bob DB's tables + the
   `agent_run_status` enum are owned by the `postgres` superuser (82/85 objects);
   the `bob` app role (`forge db url --app bob` + the Hyperdrive runtime) has DML
   but CANNOT run DDL on them — `pnpm -F @bob/db migrate` as `bob` fails with
   `42501 must be owner`. Run migrations as `postgres` via peer auth on the box
   (no stored superuser secret):
   ```
   scp packages/bob/src/db/drizzle/00NN_*.sql root@hetzner-master:/tmp/
   ssh root@hetzner-master \
     "sudo -u postgres psql -d bob -v ON_ERROR_STOP=1 --single-transaction -f /tmp/00NN_*.sql \
      && sudo -u postgres psql -d bob -c \"INSERT INTO bob_migrations(filename,hash) VALUES('00NN_*.sql','<sha256>') ON CONFLICT DO NOTHING\""
   ```
   Default privileges (`ALTER DEFAULT PRIVILEGES FOR ROLE postgres … GRANT … TO
   bob`) auto-grant `bob` full DML on every new `postgres`-created table, so the
   gateway can use them at once (verify with `has_table_privilege('bob', …)`).
   `0022` (enum `blocked`/`host_unknown`, `runner_leases`, `notification_outbox`,
   `gateway_config`, `dispatch_spec`, `session_events.send_seq`) was applied to
   prod this way on 2026-07-13. The gateway throws invalid-enum / missing-relation
   on first query without the migration applied.
2. Deploy the **gateway** before the **runner**. The envelope protocol has the
   runner journal + replay frames the gateway acks; a new runner talking to an
   old gateway that doesn't ack would never truncate its journal and would
   replay its whole history on every reconnect (the old gateway re-persists each
   as a new row). Gateway-first avoids that window. A gateway ROLLBACK likewise
   requires clearing runner event buffers.

## Known residuals (accepted for v1)

- **ctl.sock is a same-UID boundary, not intra-user isolation.** The wrapper,
  its agent, and the runner all run as the same Unix user, so a compromised
  supervised agent can read a sibling run's `wrapper.json` token (mode 0600) and
  drive its socket. The token challenge + 0700/0600 perms close the CROSS-user
  hole; true intra-user isolation needs per-run Unix users or a sandbox and is
  out of scope. A v1 wrapper that survives the auth-introducing deploy is also
  unauthenticated until it exits.
- **Legacy `NUDGE_SHARED_SECRET` is an unscoped cross-user ramp.** It is accepted
  on `/internal/*` unless `BOB_ALLOW_LEGACY_NUDGE_SECRET=false`, and a legacy
  principal bypasses per-user/workspace scoping (and is console-logged, not
  written to `event_log`, because it has no real user id). **Set
  `BOB_ALLOW_LEGACY_NUDGE_SECRET=false` as soon as every internal caller
  (Worker, t3code, cron) presents a per-user API key** — until then the ramp is
  a real cross-user path.

## Fast-follow (not in this slice)

- **Retry from the immutable dispatch spec.** `agent_runs.dispatch_spec` /
  `chat_conversations.dispatch_spec` columns exist but are not yet written at
  dispatch time and there is no retry affordance — deferred with the web/mobile
  run-screen work.

## Auth

- Gateway auth is REAL: Better Auth sessions (browsers/mobile) + hashed
  revocable API keys (daemons). `BOB_AUTH_BYPASS` in production = the
  gateway **refuses to boot**. Never re-add it to a unit file.
- `/internal/*` endpoints accept API keys; the legacy `NUDGE_SHARED_SECRET`
  works only while `BOB_ALLOW_LEGACY_NUDGE_SECRET` is not `false`. Retire it:
  provision API keys for the Worker + t3code mirror, flip the flag, watch
  logs for `legacy NUDGE_SHARED_SECRET` warnings (there should be none).
- Host credential rotation: create a new API key in settings, update the
  runner env on `hetzner-bob`, restart runner, revoke the old key, confirm
  the lease re-registers (`runner_leases.connector_instance_id` changed).

## DB credential rotation (T1 — prerequisite for prod migrations)

The Tailscale-direct path (`DATABASE_URL_LOCAL`) has a stale password
(28P01); Hyperdrive runtime works. Rotate in one pass:
1. `ALTER ROLE ... PASSWORD` on hetzner-master Postgres.
2. Update Hyperdrive config (`forge db` / CF dashboard) — verify
   bob.blder.bot still serves.
3. Update `DATABASE_URL_LOCAL` secret (forge secret set) — verify
   `db:push` works from the laptop.
4. Update gateway/runner `.env` files on both boxes; restart both.

## Fault-injection verifier

`scripts/verify-trust-slice.sh all` from the laptop (SSH to both boxes).
Eight checks incl. the CLI permission-flag probe and the real-Postgres row
lock proof. Run before declaring any milestone, and after any CLI upgrade on
`hetzner-bob` (`cli-probe` is the cheap one to re-run —
`CLAUDE_PERMISSION_PROMPT_ARGS` is a version-probed boundary).

## The 10-run trust gate (acceptance)

Ten consecutive unattended real runs; the counter resets ONLY on a trust
defect: missed/false/duplicate-intent notification, or displayed state
contradicting reality. A legitimately failing run with correct escalation
counts. "Not watching" is measured: no `observe.run_view` audit rows between
dispatch and first notification. Track the tally in the design doc; the gate
opens sustained unattended use, it does not end measurement.

## Known incident classes

| Signal | Likely cause | First move |
|---|---|---|
| Dead-man fires (master) | gateway crash-loop or PG connection exhaustion | `journalctl -u bob-ws-gateway -n 50`; `select count(*) from pg_stat_activity` |
| Dead-man fires (bob) | runner wedged / box OOM | `journalctl -u ooda-runner -n 50`; check swap (added 7/06) |
| host_unknown storm | lease sweep after real runner death | restart runner; adoption re-attaches live wrappers, corrective pushes retract alarms |
| Pushes silent, badge grows | Expo/APNs trouble | outbox rows say sent? check receipts errors in `notification_outbox.last_error` |
