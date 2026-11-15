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
  "commands": { "operations": ["ControlPlan", "RetryItem", "CancelItem", "ReconcileItem"] }
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
  logged too, with a null actor. Rollback: an older release refuses a
  version-4 database (`StorageVersion`), so restore the pre-upgrade backup or
  drop `coordination_command_log` and set `PRAGMA user_version = 3` before
  pointing `current` back.
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

If either file is missing or invalid, the worker logs `step: "edge"`,
`outcome: "configuration-unavailable"` once and keeps dispatching without the
exporter. Edge outages log `outcome: "unavailable"` and back off; they never
stop dispatch.

### Rollout and rollback order

`--edge` only exists from the BOB-75 release on. Before that release,
`worker.mjs` parses its flags with strict `parseArgs`, so an older worker
started with `--edge` exits at once on the unknown option. `Restart=on-failure`
then keeps restarting it, and nothing is dispatched until the unit or the
release is fixed. Order every change so the unit file never passes `--edge` to
a release that does not know it:

1. **Rollout:** install the new coordinator release, verify it (see
   "Verification and rollback"), point `current` at it and restart both units
   with the *previous* worker unit file. Only then install the worker unit
   that passes `--edge`, run `systemctl daemon-reload` and restart the worker.
2. **Rollback:** first restore the previous worker unit file (without
   `--edge`) and run `systemctl daemon-reload`. Only then point `current` back
   at the older release and restart.

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
