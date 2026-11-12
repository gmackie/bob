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

To roll back, stop the worker first, then the coordinator. Point `current` back
to its previous release and restart both units after checking storage
compatibility. Preserve the database and unknown attempts; never delete durable
state to make a retry succeed. For a first install, disable the two units and
remove only the newly added Tailscale Serve port with
`tailscale serve --https=8444 off`. Leave port 8443 intact.

T3 runtime upgrades require a separate migration snapshot and quiescent run
check. Preserve its worktree, Codex and CLI proxy systemd drop-ins. Rehearse
rollback against a snapshot before switching the production runtime; see
[the T3 operations runbook](../../docs/operations/bob-t3-server.md).
