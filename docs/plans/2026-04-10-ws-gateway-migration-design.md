# WS Gateway Migration Design

**Date:** 2026-04-10
**Status:** Design approved, ready for implementation plan

## Problem

The current TS gateway at `apps/gateway/` is a 2000-line monolith that does too much:
WebSocket relay, event persistence, agent spawning via Docker, git operations, file
operations, secret brokering, ForgeGraph build/deploy runners. It runs on labnuc
behind a dead Cloudflare Quick Tunnel (`wss://assets-posted-rand-whom.trycloudflare.com`),
which means all agent interactions on blder.bot are broken — chat sits on
"Connecting..." forever.

The planning, tasks, PRs, and deployment flow all depend on this WS connection,
so the entire product is effectively non-functional for anyone using blder.bot.

## Goal

Split the gateway into two pieces:

1. **Slim WS relay** on hetzner-master behind `wss://ws.blder.bot/sessions` — does
   nothing but route messages between browsers and daemons, and persist events.
2. **Go daemon** on each node — absorbs all execution (agent spawning, git ops,
   file ops, builds, deploys). Already exists at `/Users/mackieg/dev/bob-cli` with
   heartbeat, repo discovery, agent launching, artifact collection. Needs a WS
   client to talk to the gateway in realtime instead of HTTP polling.

Both blder.bot and the gateway will move off Neon to a Hetzner Postgres.

## Architecture

```
┌──────────────┐
│  blder.bot   │  Cloudflare Workers — serves HTML/JS + tRPC API
│  (HTML/JS)   │
└──────┬───────┘
       │ browser loads page
       ▼
┌──────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  Browser     │────▶│  Slim WS Gateway     │◀────│  bob daemon  │
│  (user)      │ wss │  (hetzner-master)    │ wss │  (labnuc)    │
│              │     │  wss://ws.blder.bot  │     │  Go binary   │
│  JS client   │     │  - /sessions WS      │     │  - agents    │
│  subscribes  │     │  - event persistence │     │  - git/fs    │
│  to sessions │     │  - session nudges    │     │  - builds    │
└──────────────┘     └──────────┬───────────┘     └──────────────┘
                                │
                         ┌──────┴───────┐
                         │              │
                    ┌────▼────┐    ┌────▼────────┐
                    │ Hetzner │    │  Other      │
                    │ Postgres│    │  bob daemons│
                    └─────────┘    │  (any node) │
                                   └─────────────┘
```

## Slim Gateway Scope

**What it does:**

1. **WS relay** — Matches browser clients and Go daemons by session ID.
2. **Event persistence** — Every event flowing through is batched and written to
   `session_events` (Hetzner Postgres). Uses existing `PersistenceWriter` with
   50-event batches and 100ms flush interval.
3. **Session nudge** — When a new `chat_conversations` row appears with status
   `pending`, gateway pushes a `session_available` message to the right daemon.

**What it does NOT do:** Spawn agents, run builds, execute git, manage files,
broker secrets, manage Docker, run ForgeGraph pipelines. All of that is the
Go daemon's job.

**Endpoints:**

| Endpoint | Type | Purpose |
|----------|------|---------|
| `/sessions` | WebSocket | Main protocol for browsers and daemons |
| `/health` | HTTP GET | Health check (connection counts, uptime) |
| `/internal/nudge` | HTTP POST | Internal endpoint blder.bot calls when a new session is created |

**Code organization** (`apps/ws-gateway/` as a fresh package):

```
apps/ws-gateway/
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── index.ts              # HTTP + WS server bootstrap (~150 lines)
│   ├── auth.ts               # Browser + daemon auth validation (~100 lines)
│   ├── relay.ts              # Session routing, connection maps (~200 lines)
│   ├── persistence.ts        # Copied from old gateway (~150 lines)
│   ├── nudge.ts              # /internal/nudge handler (~50 lines)
│   └── protocol.ts           # Copied from old gateway, extended (~250 lines)
└── test/
    ├── auth.test.ts
    ├── relay.test.ts
    └── persistence.test.ts
```

Target: ~900 lines total (down from ~11700 in the old gateway).

## Protocol

The existing `apps/gateway/src/ws/protocol.ts` is the starting point. Keep:
`hello`, `hello_ok`, `subscribe`, `subscribed`, `unsubscribe`, `input`, `event`,
`ack`, `ping`, `pong`, `error`. Drop: `create_session`, `stop_session`,
`subscribe_workspace`, `unsubscribe_workspace` (those were for the old fat
gateway model where the gateway itself spawned agents).

### New message types

**Daemon → Gateway:**

```typescript
interface DaemonHello {
  type: "hello";
  clientId: string;
  deviceType: "daemon";
  token: string;           // API key from bob login
  workspaceId: string;     // from daemon config.yaml
}

interface DaemonSessionClaimed {
  type: "session_claimed";
  sessionId: string;
}

interface DaemonSessionEvent {
  type: "session_event";
  sessionId: string;
  eventType: "output_chunk" | "message_final" | "tool_call" | "tool_result" | "state" | "error";
  direction: "agent" | "system";
  payload: Record<string, unknown>;
}

interface DaemonSessionStatus {
  type: "session_status";
  sessionId: string;
  status: "running" | "idle" | "completed" | "failed" | "stopped";
}
```

**Gateway → Daemon:**

```typescript
interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
}
```

### Connection semantics

- Each browser connection is registered in `clientConnections: Map<userId, Set<Connection>>`
- Each daemon connection is registered in `daemonConnections: Map<workspaceId, Connection>`
  (a workspace has at most one active daemon — if a new one connects, the old
  one gets a graceful disconnect)
- Session subscriptions are tracked in `sessionSubscribers: Map<sessionId, Set<Connection>>`

### Auth

**Browser:**
1. `hello.token` is a better-auth session token
2. Gateway queries the `session` table in Postgres directly (not via better-auth
   HTTP API — we own the same DB) to get the `userId`
3. If valid, register the connection and reply with `hello_ok`

**Daemon:**
1. `hello.token` is an API key from `bob login` (device-code flow, already exists)
2. Gateway hashes and looks up in `api_keys` table → get `userId`
3. Gateway verifies `hello.workspaceId` belongs to that user (`workspaces.ownerUserId = userId`)
4. Register in `daemonConnections[workspaceId]`, reply with `hello_ok`

### Session routing

- **Browser subscribes to session**: Gateway queries `chat_conversations` to verify
  `userId` owns the session, then registers the connection under `sessionSubscribers[sessionId]`.
  Replays events from `session_events WHERE session_id = ? AND seq > lastAckSeq ORDER BY seq LIMIT 500`.
  If more than 500 pending events exist, sends `replay_truncated` so the browser
  can fetch older ones via HTTP.

- **Daemon emits session event**: Gateway verifies the daemon's `workspaceId`
  owns the session, writes to `session_events` via `PersistenceWriter`, then
  forwards to all subscribers in `sessionSubscribers[sessionId]`.

- **Browser sends input**: Gateway looks up the session's workspace, finds the
  daemon connection in `daemonConnections[workspaceId]`, forwards the input.
  If no daemon online, returns an error event to the browser.

### Session nudge flow

1. Browser clicks "New Idea" → blder.bot tRPC `planning.createTask` mutation
2. tRPC writes `chat_conversations` row with `status: "pending"`, `workspaceId: <user default>`
3. tRPC does `fetch("https://ws.blder.bot/internal/nudge", {method: "POST", body: {sessionId, workspaceId}, headers: {authorization: "Bearer <shared-secret>"}})`
4. Gateway validates the shared secret, looks up `daemonConnections[workspaceId]`,
   sends `session_available` to that daemon
5. Daemon receives `session_available`, sends `session_claimed`, starts the agent
   locally, begins streaming events back via `session_event`

**Offline daemon recovery**: If the daemon is offline when the session is created,
the nudge fails silently. When the daemon reconnects (on `hello`), it queries
`SELECT * FROM chat_conversations WHERE workspace_id = ? AND status = 'pending'`
and picks up any pending sessions. This makes the nudge a pure optimization,
not a correctness requirement.

## Go Daemon Changes

**Current state** (`/Users/mackieg/dev/bob-cli`):
- `cmd/start.go` — runs heartbeat loop + HTTP poll for queued runs
- `cmd/run_loop.go` — polls `GET /api/runs?status=queued`, spawns agents, posts results
- `cmd/login.go` — device-code auth flow (already works)
- `internal/agent/launcher.go` — spawns CLI agents (claude, codex, etc.)
- `internal/artifacts/collector.go` — collects diffs and logs
- `internal/discovery/` — repo and agent detection
- `internal/api/client.go` — HTTP client for blder.bot API

**What changes:**

1. **Add `internal/ws/client.go`** — Persistent WS client with auto-reconnect,
   hello handshake, message routing. Reconnects with exponential backoff
   (1s → 2s → 4s → 8s → 16s → 32s max). On reconnect, re-subscribes to
   any in-flight sessions.

2. **Add `internal/ws/protocol.go`** — Go structs matching TS `protocol.ts`.
   JSON marshaling, message type dispatcher.

3. **Refactor `cmd/run_loop.go`** — Instead of polling for runs, listen for
   `session_available` via WS. When received, spawn agent as before but route
   the agent's stdout/stderr through `DaemonSessionEvent` messages instead of
   collecting it at the end.

4. **Add `internal/session/streamer.go`** — Wraps agent stdio, converts each
   line or chunk into a `session_event` with `eventType: "output_chunk"`.
   On agent exit, sends `session_status: "completed"` (or `"failed"`).

5. **Keep heartbeat on HTTP** — The heartbeat loop in `cmd/run_loop.go` stays
   as-is. It updates node metadata, repo lists, agent types — bulk data that
   doesn't need realtime. Heartbeat interval: 30s.

6. **Keep artifact uploads on HTTP** — Diffs and logs are binary, POST them via
   the existing `client.CreateArtifact()`.

**Connection URL**: `wss://ws.blder.bot/sessions`. The gateway URL is hardcoded
in the daemon, same as how `config.BaseURL()` hardcodes `https://blder.bot/api`.

**Reconnect behavior**: If WS drops, daemon keeps any in-progress agents running
(they write to their own logs/files — artifacts are local). On reconnect, it
sends `hello` with `workspaceId`, then for each in-progress session sends
`session_claimed` (which the gateway treats as a reclaim) and resumes streaming.

## Database Migration

Both blder.bot and the gateway need the same Postgres. Currently on Neon
(`ep-cool-glade-aekl2h1z.c-2.us-east-2.aws.neon.tech`). Target: Hetzner Postgres
on hetzner-master.

**Steps:**

1. Stand up Postgres on hetzner-master (or use existing if ForgeGraph already
   runs one). Create database `bob`, user with full privileges.
2. `pg_dump` from Neon: `pg_dump "$NEON_URL" > bob.dump`
3. `pg_restore` to Hetzner: `pg_restore -d "$HETZNER_URL" bob.dump`
4. Verify row counts match for every table.
5. Update blder.bot CF Workers env: `DATABASE_URL` → Cloudflare Hyperdrive
   pointing at Hetzner Postgres (Hyperdrive required because CF Workers can't
   hold long-lived Postgres connections).
6. Update gateway env: `DATABASE_URL=postgresql://bob@localhost:5432/bob`
   (localhost, no pooler needed).
7. Deploy blder.bot, verify it reads/writes correctly.
8. Keep Neon read-only for 48h as a safety net.
9. After 48h of stable operation, decommission Neon.

**Schema sync**: The `@bob/db` package is the single source of truth for the
schema. Both the gateway and blder.bot import from it. Migrations run via
`drizzle-kit push` against whichever `DATABASE_URL` is active.

## Deployment

**Hetzner-master:**

```
/opt/bob-gateway/
├── dist/index.js          # bundled gateway
├── node_modules/
├── .env                   # DATABASE_URL, NUDGE_SHARED_SECRET, etc.
└── package.json
```

**Systemd unit** (`/etc/systemd/system/bob-gateway.service`):

```ini
[Unit]
Description=Bob WS Gateway
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=bob
WorkingDirectory=/opt/bob-gateway
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
EnvironmentFile=/opt/bob-gateway/.env

[Install]
WantedBy=multi-user.target
```

**ForgeGraph Caddy route** (added to the existing hetzner-master Caddyfile):

```caddy
ws.blder.bot {
    reverse_proxy localhost:3002
}
```

Caddy handles TLS via Let's Encrypt and WebSocket upgrade headers automatically.

**blder.bot CF Workers env update:**

```
GATEWAY_PUBLIC_URL=https://ws.blder.bot
NUDGE_SHARED_SECRET=<random-32-byte-hex>  # matches gateway's .env
```

The daemon has the gateway URL hardcoded (`wss://ws.blder.bot/sessions`), no env
var needed on the node side.

## Implementation Phases

### Phase 1: Slim gateway (fresh package)

- Create `apps/ws-gateway/` with `package.json`, `tsconfig.json`, `Dockerfile`
- Write `src/index.ts`, `src/auth.ts`, `src/relay.ts`, `src/persistence.ts`,
  `src/nudge.ts`, `src/protocol.ts`
- Unit tests for auth validation, protocol parsing, session routing
- Local integration test: start gateway against a local Postgres, connect
  browser and daemon test clients, verify end-to-end flow

### Phase 2: Go daemon WS client

- Add `internal/ws/client.go` and `internal/ws/protocol.go` to `bob-cli`
- Add `internal/session/streamer.go` for event emission
- Refactor `cmd/run_loop.go` to listen on WS instead of polling
- Keep HTTP heartbeat and artifacts
- Unit tests for WS client reconnect logic and message routing
- Local integration test against the new gateway

### Phase 3: Database migration

- Stand up Hetzner Postgres
- Dump and restore from Neon
- Verify row counts
- Update blder.bot CF Workers to use Hyperdrive → Hetzner
- Update gateway to use Hetzner (localhost)
- Run blder.bot for 48h against Hetzner with Neon as read-only backup
- Decommission Neon

### Phase 4: Deploy & cutover

- Build and deploy gateway to hetzner-master
- Configure systemd unit
- Add ForgeGraph Caddy route for `ws.blder.bot`
- Update blder.bot CF Workers env (`GATEWAY_PUBLIC_URL`, `NUDGE_SHARED_SECRET`)
- Build and distribute new `bob` daemon binary (via `brew install blder/tap/bob`
  or direct download)
- Run `bob upgrade` on labnuc, verify daemon reconnects and can handle sessions
- End-to-end smoke test on blder.bot:
  1. Create idea → chat_conversations row written with status=pending
  2. Gateway nudges daemon → daemon claims and spawns agent
  3. Agent output streams back through gateway to browser
  4. Browser sends input → gateway forwards to daemon → agent receives
  5. Agent completes → session_status: completed → row updated
  6. Browser sees the final state

### Phase 5: Cleanup

- Delete `apps/gateway/`
- Delete `apps/execution/` (if it's only the old gateway's child process manager)
- Remove `GATEWAY_URL`, `AGENT_IMAGE`, and other dead env vars from all configs
- Update `CLAUDE.md` and memory to reflect the new architecture

## Out of Scope

- Multi-gateway HA — the slim gateway is a single instance on hetzner-master.
  If it dies, browsers can't stream in realtime until systemd restarts it
  (seconds). Agents keep running on nodes. Events are persisted, so nothing is
  lost. Good enough for v1.
- Mobile client connections — the protocol supports `deviceType: "ios" | "android"`
  but we're not wiring up mobile clients in this migration.
- Workspace-level subscriptions — removed from the protocol. If we need the
  "watch all sessions in this workspace" feature later, we'll add it back.
- File/git operations exposed to browsers — the browser will call tRPC on
  blder.bot for file reads and git diffs, which proxies to the daemon via a
  new daemon HTTP endpoint. That's a separate design.

## Risks & Mitigations

- **Risk**: Database migration corrupts data. **Mitigation**: 48-hour Neon
  read-only window, verify row counts at every step, back up Neon before dump.
- **Risk**: Gateway crashes drop all live subscriptions. **Mitigation**: Events
  are persisted, so browsers reconnect and replay. Systemd auto-restarts in
  seconds.
- **Risk**: Daemon protocol change breaks existing installs. **Mitigation**:
  N/A — we're doing a clean break, not backwards-compatible. Daemons must
  upgrade to the new binary. Users run `bob upgrade`.
- **Risk**: Nudge endpoint gets abused. **Mitigation**: Shared secret between
  blder.bot CF Workers and gateway. Rotate via env var if leaked.
- **Risk**: ForgeGraph build/deploy runners stop working (they lived in the
  gateway). **Mitigation**: Move them into the Go daemon as a separate goroutine
  loop. Each daemon that has `forge` CLI available polls for pending builds
  and handles them. Scheduled for after this migration.

## Open Tasks Tracked Elsewhere

- ForgeGraph build/deploy runners → new Go daemon goroutine (separate design)
- File/git browser access via tRPC → separate design
- Mobile client WS support → future
- Gateway HA → future
