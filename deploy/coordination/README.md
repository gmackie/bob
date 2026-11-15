# Hetzner coordinator installation

Tracked by BOB-55; remote MCP implementation: BOB-68. These units run the
standalone `packages/bob/coordination` package, independently of the Cloudflare
web deployment. Node 24 or newer is required. No additional execution daemon
or scheduler is installed.

## Artifact and storage

Package a clean, published revision's `packages/bob/coordination` directory,
excluding `node_modules`. Retain the source revision, archive SHA256 and lockfile
SHA256 with the deployment receipt. Extract into
`/opt/bob-coordinator/releases/<source-revision>`, run
`npm ci --ignore-scripts` using the service user's Node runtime, then run
`npm run verify` and `npm audit`. Keep the lock unchanged. After verification,
production can retain only runtime dependencies using `npm prune --omit=dev
--ignore-scripts`.

Full verification also needs Rust/C build tools when the exact ForgeC compiler
from `compiler.json` is not already cached. This is a build prerequisite, not a
runtime dependency. Do not skip generation checks after a missing-compiler error.

Point `/opt/bob-coordinator/current` at that release. Keep the previous release
and link destination for rollback. Create a private, bob-owned directory at
`/mnt/HC_Volume_106611335/bob/coordination` and symlink
`/home/bob/.bob/coordination` to it. Both units share its SQLite database;
include SQLite WAL state in backups, using the SQLite backup API while live.

## Private operator configuration

Create `/etc/bob/coordination` as root:bob, mode 0750, and its JSON files as
root:bob, mode 0640. Do not commit these files or include their contents in
deployment logs. The [MCP guide](../../packages/bob/coordination/REMOTE-MCP.md)
describes the supervisor's implemented operations and principal policy.

- `context.json`: trusted workspace/actor, exact execution targets and authorized
  Kanbanger issue projects; used by the worker.
- `principals.json`: unique supervisor and environment receipt bearer tokens
  (at least 32 characters); each uses the worker's workspace/actor and policy.
  Only the receipt principal gets `RecordExecutionReceipt`, and it must bind
  `receiptEnvironmentId`. A separate read-only principal can get the six queries.
- `kanbanger.json`: `integrationId`, `endpoint` set to
  `https://tasks.gmac.io/graphql`, and the operator's API `token`.
- `bindings.json`: array of `{ target, baseUrl, authToken }`, matching each full
  execution target exactly. The T3 bearer session requires `orchestration:read`
  and `orchestration:operate`; retain its subject when rotating credentials.

Configure T3's `userdata/bob-coordination.json` with the coordinator viewer and
receipt endpoints, project/issue-project bindings and explicit execution
profiles. See T3's `docs/operations/bob-coordination.md`. Never substitute the
legacy thread-launch route when capability negotiation fails.

## SDLC edge exporter (BOB-75)

The worker pushes plan and work-item changes to the SDLC edge with
`--edge /etc/bob/coordination/edge.json`. It needs two private files in
`/etc/bob/coordination`, both root:bob, mode 0640, never committed:

- `edge.env`: `BOB_SDLC_EDGE_TOKEN=<token>`, the edge ingest bearer token. The
  worker unit loads it with `EnvironmentFile=-/etc/bob/coordination/edge.env`.
  The leading dash keeps the unit starting when the file is absent; without the
  dash, systemd refuses to start the worker at all.
- `edge.json`: `{ "endpoint", "checkpoint", "tokenEnv" }`, with `endpoint` the
  edge's `https://…/api/sdlc/ingest` URL, `checkpoint` set to
  `/home/bob/.bob/coordination/edge.sqlite`, and `tokenEnv` set to
  `BOB_SDLC_EDGE_TOKEN`. The token never goes in this file.

### Command channel (BOB-79)

Bob's SDLC surfaces (web, TUI, mobile) send commands to the edge, which queues
them and returns them in its ingest response (`commands`). The exporter runs
them in-process and reports `results` in its next batch. There is no inbound
port. The channel is off unless `edge.json` has a `commands` block:

```json
{
  "endpoint": "https://<bob-host>/api/sdlc/ingest",
  "checkpoint": "/home/bob/.bob/coordination/edge.sqlite",
  "tokenEnv": "BOB_SDLC_EDGE_TOKEN",
  "commands": { "operations": ["ControlPlan", "RetryItem", "CancelItem", "ReconcileItem", "ResolveInput"] },
  "tail": {}
}
```

- `commands.operations` is the edge principal's allowlist: a non-empty, unique
  subset of the relayed operations above (no other key is accepted). List fewer
  to narrow it, for example only `["ControlPlan"]` for pause/resume. A command
  outside it is answered with error code `Forbidden`; with no `commands` block,
  every relayed command is answered `Forbidden`. An invalid block makes the
  whole file invalid (`configuration-unavailable`, exporter off).
- The edge principal's context is the worker's own `--context` file
  (`context.json`): same workspace, actor (owner) and target/issue-project
  policy, so it can act only on plans the worker itself exports. It runs on its
  own database connection with the same validation, `Idempotency-Key =
  commandId` replay and Kanbanger issue admission as the HTTP host.
- Each command's `actor` (the Bob user id the edge verified) is recorded, with
  the principal owner and outcome, in `coordination_command_log` (storage
  version 4; older stores upgrade on start). Direct HTTP/MCP commands are
  logged too, with a null actor. The log is append-only: a refusal, the
  acceptance and a later completion of one `commandId` are separate rows
  (indexed by `command_id`). An older release refuses a version-4 database
  (`StorageVersion`); see "Storage version 4 rollback" below.
- Transient failures while running a command (SQLite busy, Kanbanger or
  network errors, any 5xx or non-coordinator error) are not reported: the
  exporter logs `outcome: "command-transient"` with the code only, and the edge
  re-sends the command after its 10 s redelivery interval until it runs or the
  edge expires it at 10 minutes. Only coordinator refusals (4xx) reach Bob with
  their message; anything else reads "The coordinator could not run this
  command."
- Unreported results live in `edge.sqlite` (`edge_command_result`) and are
  re-sent after a crash; re-delivered commands replay the stored Operation.
- While commands or results are in flight, or the edge's response carries
  `pollMs`, the worker contacts the edge every ~2 s (or `pollMs`, clamped to
  1–30 s) instead of every 30 s. Idle behaviour is unchanged.
- `CancelItem` cancels an item without a live attempt (or with a queued,
  never-submitted one) at once. With a live or unknown execution it moves the
  item to `cancelling`: no environment cancellation port exists yet, so the
  running execution is not interrupted; the item settles to `cancelled` on its
  terminal receipt, or when the worker finds no execution for it (it never
  submits a new one). Kanbanger is not updated for coordinator-side cancels.
- `ReconcileItem` (for `execution-unknown` only) expires the attempt's back-off
  so the next worker tick re-runs the FindExecution recovery. `TriggerPlan`
  remains unimplemented (501).
- `ResolveInput` (BOB-80) answers the question a `waiting-input` item shows.
  It needs the tail relay below: without it nothing ever puts an item in
  `waiting-input`, so the command is refused (`InvalidTransition`).

### Tail relay and pending input (BOB-80)

A `tail` block in `edge.json` turns on the tail relay inside the worker:
`"tail": {}` or `"tail": { "postIntervalMs": 2000 }` (2000–30000 ms, default
2000; no other key is accepted, and an invalid block makes the whole file
invalid). It is a block, not a worker flag, so the unit file does not change
and an older release simply ignores it. Remove the block and restart the worker
to turn the relay off; dispatch and the exporter keep running.

- For every attempt whose item is `running` or `waiting-input`, the relay opens
  a WebSocket to the attempt's t3 server, using the `bindings.json` entry that
  matches the attempt's target (same `baseUrl` and `authToken` as dispatch), at
  `/ws?orchestrationProtocol=2` with `Authorization: Bearer`. It follows the
  attempt's thread and the shell, and unsubscribes when the item leaves those
  states. The token needs `orchestration:read` and `orchestration:operate`.
- A pending `user_input` request (shell `pendingRuntimeRequest` plus its
  `user_input_request` item) moves the item to `waiting-input` with
  `pendingInput`. Requests marked `userOnly` or `not_resumable`, and other
  kinds (approvals), are never recorded. When t3 shows the request resolved
  without Bob (answered in the T3 UI), the item returns to `running`.
- `ResolveInput` moves the item back to `running` at once and queues the
  answer in `coordination_input_delivery`; the relay sends it with
  `runtime-request.respond` (a `commandId` stable per attempt and prompt) once
  t3 shows the request still pending, retries with back-off, and survives
  restarts. The Operation is `accepted` until then, `succeeded` when delivered,
  or `failed` (`InputNotDelivered`) when the attempt ended or t3 was answered
  elsewhere first. The answer text is erased from the row once settled.
- Assistant, reasoning and command lines (the last 40, 200 characters each) are
  POSTed to `<edge origin>/api/sdlc/tail` with the ingest token, at most once
  per `postIntervalMs`, and dropped if the edge is unavailable. The edge never
  stores them.
- Logs carry `step: "tail"` with attempt and prompt ids and error codes only:
  never answers, question text or tokens.
- Not yet verified live: that the hetzner-bob front proxy forwards `Upgrade`
  and `Authorization` on `/ws` (the relay logs `outcome: "t3-rejected"` with
  the HTTP status if not; the one-time `wsTicket` fallback is not implemented).

If either file is missing or invalid, the worker logs `step: "edge"`,
`outcome: "configuration-unavailable"` once and keeps dispatching without the
exporter. Edge outages log `outcome: "unavailable"` and back off; they never
stop dispatch.

### Push alerts (BOB-81)

The SDLC edge (the Bob Cloudflare Worker's `SdlcEdge` Durable Object) pushes an
alert when an item enters waiting-input (once its prompt is set), review or
failed, and writes an inbox row for it. Those rows use three new
`work_item_notification_type` values from migration
`packages/bob/src/db/drizzle/0042_sdlc_notification_types.sql`.

**Apply migration 0042 to production before deploying the Worker that carries
BOB-81.** A Worker deployed first fails every alert insert on the unknown enum
value: ingest is unaffected (alerts are sent in the background), but those
alerts are lost and still count against the per-user push limit (below). Apply
it with `pnpm --filter @bob/db migrate:production` (as for BOB-76's 0041),
then confirm:

```sh
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::work_item_notification_type))" | grep sdlc_
```

All three values (`sdlc_waiting_input`, `sdlc_review`, `sdlc_failed`) must be
listed before the Worker deploy. The migration only adds enum values, so it is
safe to apply ahead of the Worker and needs no rollback when the Worker is
rolled back.

The push body is generic (repository and a call to action, never the agent's
question or plan internals); the inbox row keeps the question. Each user gets
at most 10 SDLC pushes per 10 minutes; the slot is recorded when the delivery
is planned, not when it is sent, so a failed send (database or Expo down)
still uses its slot until the window passes. Recording after the send would
let two batches in flight both see free room and overshoot the limit, so the
limit errs toward fewer pushes; the Attention tab still lists every item.

### Rollout and rollback order

`--edge` only exists from the BOB-75 release on. Before that release,
`worker.mjs` parses its flags with strict `parseArgs`, so an older worker
started with `--edge` exits at once on the unknown option. `Restart=on-failure`
then keeps restarting it, and nothing is dispatched until the unit or the
release is fixed. Order every change so the unit file never passes `--edge` to
a release that does not know it:

1. **Rollout:** back up the coordinator database first. This is required, not
   optional, for every release that raises the storage version — the BOB-79
   release (version 3 → 4) and the BOB-80 release (version 4 → 5). Such a
   release upgrades the store on start, and older releases then refuse it
   (`StorageVersion`). There is no automatic downgrade: going back means
   either the documented down-step ("Storage version 5 rollback", then
   "Storage version 4 rollback") or restoring this backup. Take it with the
   units stopped:

   ```sh
   sudo systemctl stop bob-coordinator-worker.service bob-coordinator.service
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite \
     ".backup '/home/bob/.bob/coordination/coordination.pre-<source-revision>.sqlite'"
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite 'PRAGMA user_version;'
   ```

   Record the printed version with the backup (`3` before BOB-79, `4` before
   BOB-80) and do not start the new release until the backup file exists
   and `sqlite3 <backup> 'PRAGMA integrity_check;'` prints `ok`. Then install the new
   coordinator release, verify it (see "Verification and rollback"), point
   `current` at it and restart both units with the *previous* worker unit file. Only then install the worker unit
   that passes `--edge`, run `systemctl daemon-reload` and restart the worker.
2. **Rollback:** first restore the previous worker unit file (without
   `--edge`) and run `systemctl daemon-reload`. Only then point `current` back
   at the older release and restart.

### Storage version 5 rollback

**A version-5 store cannot be opened by a version-4 (or older) release.** Rolling
back from BOB-80 requires one of exactly two procedures, both with the units
stopped: the down-step below (keeps everything since the upgrade except
undelivered answers), or restoring the pre-upgrade backup taken in "Rollout
and rollback order" step 1 (loses every change since the upgrade; then delete
`edge.sqlite`, see below). Pointing `current` back without either leaves both
units failing with `StorageVersion`. The same holds for version 4 → 3 ("Storage
version 4 rollback").

Storage version 5 (BOB-80) adds only `coordination_input_delivery` and its two
indexes (`coordination_input_delivery_uq_attemptId_promptId`,
`coordination_input_delivery_ix_by_owner_status_next_attempt_at`); version-4
tables are unchanged. Items may hold `pendingInput` in their snapshot JSON; a
version-4 release ignores the field. Rolling back to a version-4 release:

1. Remove the `tail` block from `edge.json` (an older worker ignores it, but
   items left in `waiting-input` would stay there), stop the worker, then the
   coordinator, and back up the database with `.backup` as in "Storage
   version 4 rollback" step 2 (name it `coordination.v5-before-rollback.sqlite`).
2. Drop the table and set the version in one transaction, then check:

   ```sh
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite \
     'BEGIN; DROP TABLE coordination_input_delivery; PRAGMA user_version = 4; COMMIT;'
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite \
     "PRAGMA user_version; SELECT name FROM sqlite_master WHERE name LIKE 'coordination_input_delivery%'; PRAGMA integrity_check;"
   ```

   Expect `4`, no names, and `ok`. Undelivered answers are lost (their
   ResolveInput Operations stay `accepted`); answer those questions in the T3
   UI. An item still in `waiting-input` can be cancelled, or settles on its
   execution receipt.
3. Reinstall the version-4 release and start the coordinator, then the worker.
   To go further back, continue with "Storage version 4 rollback".

`test/input.test.mjs` ("a version-four store gains the input delivery table")
applies exactly the step 2 SQL and reopens the store with this release.

### Storage version 4 rollback

**A version-4 store cannot be opened by a version-3 release.** Rolling back from
BOB-79 requires the down-step below or restoring the pre-upgrade backup from
"Rollout and rollback order" step 1; nothing else works.

Storage version 4 (BOB-79) adds only `coordination_command_log` and its two
indexes (`coordination_command_log_ix_by_command_id`,
`coordination_command_log_ix_by_owner_created_at`); no version-3 table changes.
Rolling back to a version-3 release therefore drops that audit table and
nothing else. The steps, in order:

1. Stop the worker, then the coordinator, so nothing writes:

   ```sh
   sudo systemctl stop bob-coordinator-worker.service
   sudo systemctl stop bob-coordinator.service
   ```

2. Back up the version-4 database (this keeps the command log):

   ```sh
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite \
     ".backup '/home/bob/.bob/coordination/coordination.v4-before-rollback.sqlite'"
   ```

3. Drop the table (its indexes go with it) and set the version, in one
   transaction, then check:

   ```sh
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite \
     'BEGIN; DROP TABLE coordination_command_log; PRAGMA user_version = 3; COMMIT;'
   sudo -u bob sqlite3 /home/bob/.bob/coordination/coordination.sqlite \
     "PRAGMA user_version; SELECT name FROM sqlite_master WHERE name LIKE 'coordination_command_log%'; PRAGMA integrity_check;"
   ```

   Expect `3`, no table or index names, and `ok`. Plans, items, attempts,
   events and issue effects are untouched, so `edge.sqlite` stays valid; its
   unreported command results (`edge_command_result`) are simply never sent by
   an older release. Restoring the pre-upgrade backup instead loses every
   change since the upgrade; prefer the drop.

4. Reinstall the previous release: if it predates `--edge`, restore the
   previous worker unit file and `systemctl daemon-reload` first (see
   "Rollout and rollback order"); point `current` back; start the coordinator,
   then the worker. A pre-BOB-79 release ignores the `commands` block in
   `edge.json`. Check that neither unit logs `StorageVersion`.

The upgrade path is covered by `test/commands.test.mjs` ("a version-three
store gains the command log table"), which applies exactly the step 3 SQL and
reopens the store: it is a valid version-3 database, and starting a version-4
release again recreates the table, empty.

To turn the edge off without touching releases or unit files, use a kill
switch. Both leave dispatch running:

- **Exporter side:** remove `/etc/bob/coordination/edge.json` and restart the
  worker. `worker.mjs` wraps `loadEdgeConfig` and `edgeExporter` in one
  try/catch, so a missing file logs `step: "edge"`,
  `outcome: "configuration-unavailable"` and the worker runs with no exporter.
  Leave `--edge` in the unit; only the file goes.
- **Cloudflare side:** set `SDLC_EDGE_WORKSPACE_ID` to `""` in the Bob
  Worker's vars and redeploy. `/api/sdlc/ingest` and `/api/sdlc/ws` then
  answer 503 before they check anything else. The exporter logs
  `outcome: "unavailable"` and backs off, and `/sdlc` shows "Reconnecting".

Once the `v1-sdlc-edge` Durable Object migration has been applied, every
later Bob Worker build, rollback builds included, must keep exporting the
`SdlcEdge` class and keep the migration in `wrangler.jsonc`. Removing the class
needs a `deleted_classes` migration, which destroys the edge's stored state.
Use the vars kill switch above instead of removing the class.

After any restore of the coordinator database, delete `edge.sqlite` before
starting the worker. The exporter then sends a fresh snapshot instead of changes
from a checkpoint that no longer matches the restored database.

## Start and connect

Install these two unit files under `/etc/systemd/system`. Run
`systemd-analyze verify` on the installed units, then `systemctl daemon-reload`
and `systemctl enable --now bob-coordinator.service
bob-coordinator-worker.service`.

The listener stays at `127.0.0.1:4780`. On hetzner-bob, an independent Tailscale
Serve HTTPS listener can expose it privately:

```sh
tailscale serve --bg --https=8444 http://127.0.0.1:4780
```

Check `tailscale serve status` first; preserve the T3 listener on port 8443 and
any existing routes. Remote URL:
`https://hetzner-bob.tail1e1a32.ts.net:8444/mcp`. Use a sensitive Authorization
header in T3's remote tool configuration. Do not put an Idempotency-Key on the
connection. T3 on Bob itself may use `http://127.0.0.1:4780/mcp`.

## Verification and rollback

Verify the installed revision/archive/lock hashes, unit state, SQLite integrity,
unauthenticated 401, authenticated MCP initialization and tool discovery,
GetCapabilities and native T3 durable admission with the configured profile.
Use a disposable Git repository and real scoped Kanbanger issues for the
dependency/replay/recovery pilot. Capture original request IDs and receipts;
one durable attempt must survive replay and restart. Agent execution success
does not establish review readiness or production delivery.

For a release that adds the SDLC edge exporter, also check that the new
release accepts `--edge` (`node runtime/worker.mjs --help` lists it) *before*
installing the worker unit that passes it. After the new unit is in, check that
the worker logs no `step: "edge"` `configuration-unavailable` line and that
`/sdlc` shows the coordinator as live.

To roll back, stop the worker first, then the coordinator. If the release you
are leaving added `--edge` and the target release does not have it, restore the
previous worker unit file (without `--edge`) and run `systemctl daemon-reload`
*before* pointing `current` back. Otherwise the older worker refuses the
unknown flag and restarts in a loop, which stops dispatch (see "Rollout and
rollback order" above). Then point `current` back to its previous release and
restart both units after checking storage compatibility. Preserve the database and unknown attempts; never delete durable
state to make a retry succeed. For a first install, disable the two units and
remove only the newly added Tailscale Serve port with
`tailscale serve --https=8444 off`. Leave port 8443 intact.

T3 runtime upgrades require a separate migration snapshot and quiescent run
check. Preserve its worktree, Codex and CLI proxy systemd drop-ins. Rehearse
rollback against a snapshot before switching the production runtime; see
[the T3 operations runbook](../../docs/operations/bob-t3-server.md).
