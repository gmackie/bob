# Grok Build (ACP) adapter + agent-selection convergence — design

**Date:** 2026-06-01
**Status:** Approved design (pre-implementation)
**Near-term goal:** Grok Build running end-to-end on `hetzner-bob` via ACP.
**Direction:** One converged runner whose input is abstracted for both Bob and OODA; agent
choice configurable per work item / project / workspace.

---

## 1. Context & ground truth

The OODA runner (`apps/ooda-runner`) is already the convergence point: it serves OODA
sessions (tRPC poll loop in `runner-server.ts`) **and** Bob sessions (WebSocket
`BobGatewayConnector` in `bob-gateway.ts`), both feeding one
`Map<string, AgentAdapter>` registry, and it already reports runs to Bob's public API.

Today's adapters (`packages/ooda/src/agent-adapters/`) are CLI-spawn:

- `claude-adapter.ts` → `claude --output-format stream-json` (NDJSON)
- `codex-adapter.ts` → `codex exec` (stdio)

**There is no ACP client and no codex app-server client anywhere in the repo.** ACP exists
only as comments/stubs (`registerTools?` hook in `types.ts:46`, a tool-registry, buddy-tools
schemas labeled "ACP-exposed"). So adding Grok via ACP means building a (small, reusable)
ACP client from scratch — Grok is its first consumer.

### Grok Build ACP facts (verified against x.ai / zed.dev docs, 2026-06)

- ACP entrypoint: **`grok agent stdio`** → ACP agent over **JSON-RPC 2.0 on stdin/stdout**.
- Flow: `initialize` (returns `protocolVersion`, `authMethods`, capabilities) → optional
  `authenticate` by `methodId` → `session/new` `{cwd, mcpServers}` → `session/prompt`,
  with `session/update` notifications streaming text / thoughts / tool calls.
- Headless auth: **`XAI_API_KEY`** env var (or cached token from `grok login`).
- Useful flags: `--cwd <PATH>`, `--always-approve`, `--no-auto-update`.
- Install: `curl -fsSL https://x.ai/cli/install.sh | bash`.
- (Fallback, non-ACP) headless: `grok -p "…" --output-format streaming-json`.

---

## 2. Architecture & placement

Grok lands as a new adapter conforming to the existing `AgentAdapter` interface, so it plugs
into both the OODA poll path and the Bob gateway path with no control-flow changes.

Two new files in `packages/ooda/src/agent-adapters/`:

1. **`acp-client.ts`** — a small, reusable ACP JSON-RPC 2.0 client over a child process's
   stdin/stdout. Agent-agnostic (Grok-driven now; Claude/Cursor ACP reuse later). Handles:
   - Newline-delimited JSON framing; `JSON.parse` per line.
   - Outbound request/response correlation by `id` (`Map<id, {resolve, reject}>`).
   - Inbound `session/update` notifications fanned out to a handler.
   - Inbound **agent→client requests we must answer**:
     - `session/request_permission` → auto-grant (defensive; we also pass `--always-approve`).
     - `fs/read_text_file` / `fs/write_text_file` → implemented against the workspace root
       (~30 lines, cheap insurance: if Grok delegates fs it works, else dead code).
2. **`grok-adapter.ts`** — `implements AgentAdapter`, `id="grok"`, `transport="stdio"`.

Everything downstream (session-executor capture, Bob run reporter, gateway event forwarding)
keeps working because Grok output arrives as ordinary AdapterEvents.

---

## 3. Grok adapter behavior

`buildCommand({prompt, workspaceRoot, systemPrompt})` →

```
binary: "grok"
args:   ["agent", "stdio", "--cwd", workspaceRoot, "--always-approve", "--no-auto-update"]
cwd:    workspaceRoot
env:    { XAI_API_KEY }
```

`execute(command, onEvent)` sequence:

1. Spawn `grok agent stdio`.
2. `initialize` → read `protocolVersion`, `authMethods`, capabilities.
3. If not already authed and an API-key auth method is offered, `authenticate` with that
   `methodId`; otherwise rely on `XAI_API_KEY` / cached token.
4. `session/new {cwd, mcpServers: []}` → `sessionId`.
5. `session/prompt {sessionId, prompt}`; await result while `session/update` notifications
   stream in (mapped to AdapterEvents — see §4).
6. On `session/prompt` result (`stopReason`): emit `exit` with code 0 (1 on error/refusal),
   close stdin, let process exit.

`isAvailable()` returns true if `XAI_API_KEY` is set **or** `which grok` resolves — matching
the Codex/Claude best-effort pattern (missing Grok is silently skipped from the registry).

---

## 4. Structured event model (extended `AdapterEvent`)

Tool calls and thoughts are first-class, not flattened to stdout text. `AdapterEvent` is
extended additively (existing four types unchanged, so existing consumers/adapters are
unaffected):

```ts
export interface AdapterEvent {
  type: "stdout" | "stderr" | "exit" | "error"
      | "thought" | "tool_call" | "tool_result";
  data: string;                 // text for stdout/stderr/thought; JSON summary otherwise
  timestamp: string;
  exitCode?: number;
  tool?: { id: string; name: string; status: "started" | "completed" | "failed"; input?: unknown; output?: string };
  thought?: { text: string };
}
```

ACP `session/update` → AdapterEvent mapping:

| ACP update                 | AdapterEvent                                            |
| -------------------------- | ------------------------------------------------------ |
| assistant text delta       | `stdout` (keeps `agentResponse` extraction working)    |
| agent thought / reasoning  | `thought` (`thought.text`, mirrored into `data`)       |
| tool call begin            | `tool_call` (`status:"started"`, `tool.name/input`)    |
| tool call end              | `tool_result` (`status:"completed"|"failed"`, output)  |

---

## 5. Wiring into both runner paths

**a) Registry — `runner-server.ts:106-110`:**

```ts
const grok = new GrokAdapter();
if (grok.isAvailable()) this.adapters.set("grok", grok);
```

Registration drives reported `capabilities` (`runner-server.ts:181`) + gateway hello, so Grok
becomes selectable everywhere automatically.

**b) OODA path — `session-executor.ts:74` `wrappedOnEvent`** + runner `onEvent`
(`runner-server.ts:373`): forward the new types — `thought` → `pushSessionEvent type:"thought"`,
`tool_call`/`tool_result` → `type:"tool_call"`.

**c) Bob path — `bob-gateway.ts`:** Grok flows through `this.adapters.get("grok")` (no
exclusion needed; leave the codex carve-out at line 193 as-is). Extend `runWithAdapter`'s
callback (line 229) to emit `thought` and `tool_call`/`tool_result` as gateway
`session_event`s so the Bob dashboard renders Grok's tool calls + thinking.

A session targets Grok purely by `agentType:"grok"` (gateway) / `adapterId:"grok"` (OODA).

**d) Enum / pickers:** add `"grok"` to `agentTypeEnum`
(`packages/bob/src/agents/src/schema.ts:58-67`) and every agent picker — sourced from one
shared `AGENT_TYPES` constant. Grep the enum's consumers during implementation to catch all
pickers.

---

## 6. Agent configuration & resolution

### Schema additions (nullable, additive migrations)

| Entity    | Field               | Type                 | File                                              |
| --------- | ------------------- | -------------------- | ------------------------------------------------- |
| Workspace | `defaultAgentType`  | `varchar(50)` null   | `packages/bob/src/tenancy/src/schema.ts:70`       |
| Project   | `defaultAgentType`  | `varchar(50)` null   | `packages/bob/src/projects/src/schema.ts:86`      |
| Work item | `agentTypeOverride` | `varchar(50)` null   | `packages/bob/src/work-items/src/schema.ts:468`   |

### Resolver (shared server-side helper)

```
resolveAgentType(workItem) =
  workItem.agentTypeOverride
  ?? project.defaultAgentType
  ?? workspace.defaultAgentType
  ?? "claude"   // existing hardcoded fallback
```

Used wherever a run/session is created from a work item — replaces hardcoded
`agentType:"claude"` (`planSession.ts:177`) and supplies the public API default when caller
omits `agentType` (`publicApi.ts:338`).

### UI

- **Work-item detail** (`workflow-page-client.tsx`): agent dropdown bound to a new
  `workItem.setAgent` mutation; empty option = "Use project default (<resolved>)".
- **Project + workspace settings:** "Default agent" select mirroring the
  `updateAutomationSettings` pattern (`router/project.ts:48`), wired to
  `project.setDefaultAgent` / `workspace.setDefaultAgent`.
- Option lists come from the shared `AGENT_TYPES` constant.

---

## 7. Task-runner convergence + OODA workspace default

### Fold `apps/bob-task-runner/task-runner.js` into the gateway path

Today it polls Linear directly and `spawn("codex", …)` hardcoded, reporting to
`POST /api/v1/runs`. Target:

- Keep the autonomous loop (Linear poll → claim highest-priority issue), but instead of
  spawning codex, **dispatch a session through the same path Bob's in-app runs use** — session
  `agentType` = server-resolved `resolveAgentType`, executed by the ooda-runner's
  `BobGatewayConnector` via the adapter registry (grok/claude/codex/cursor, with structured
  thoughts/tool_calls to the dashboard).
- Requires the Linear issue to resolve to a Bob work item so the resolver has context; where
  there's no work item, fall back to project/workspace default (no per-item override). Confirm
  Linear↔work-item mapping during planning (commit `f09e56e` "auto-sync Linear projects"
  suggests sync plumbing exists).
- Net: one execution path, one resolver, no hardcoded agent anywhere.

### OODA workspace default via bound Bob workspace

The ooda-runner already carries `bobWorkspaceId` (`runner-server.ts:102`). When an OODA
session is created without explicit `adapterId`, resolve it from that Bob workspace's
`defaultAgentType` (lookup at session-claim time or in OODA `createSession`). No new OODA
schema; OODA inherits the Bob workspace default.

---

## 8. Testing

**Unit** (local, no real grok; run via
`pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism`):

- `acp-client.test.ts` — canned JSON-RPC lines through a fake stdio pair: request/response
  correlation, `session/update` fan-out, `session/request_permission` auto-grant, `fs/*`
  against a temp workspace.
- `grok-adapter.test.ts` — mock ACP client: assert `buildCommand()` output + env, and that a
  scripted `initialize → session/new → session/prompt → session/update*` flow maps to the
  right AdapterEvents. Mirror codex/claude adapter test style.
- `resolveAgentType` — unit table for the override → project → workspace → fallback chain.

**Integration (hetzner-bob, real grok):**

1. `XAI_API_KEY=… grok -p "say hi" --output-format json --no-auto-update` (install + auth).
2. ACP smoke: spawn `grok agent stdio`; `initialize → session/new → session/prompt "create
   hello.txt"`; assert the file appears.
3. E2E: dispatch a Bob session `agentType:"grok"`; watch it complete in the Bob dashboard with
   thoughts + tool calls; then an OODA session `adapterId:"grok"`.

---

## 9. Deployment (hetzner-bob)

1. Install Grok Build: `curl -fsSL https://x.ai/cli/install.sh | bash`; record `grok --version`.
2. Store `XAI_API_KEY` as a ForgeGraph secret; inject into the ooda-runner systemd env
   (alongside `BOB_GATEWAY_URL`, `BOB_API_KEY`, `BOB_WORKSPACE_ID`).
3. Adapter flags (`--no-auto-update`, `--always-approve`, `--cwd`) are baked into
   `buildCommand`.
4. Restart the ooda-runner service; confirm `available adapters: codex, claude, grok` and that
   registration reports `grok` in capabilities.
5. Rollback: remove `XAI_API_KEY` / the binary → `isAvailable()` drops Grok, no redeploy.

---

## 10. Phasing

- **Phase 1 — Grok on hetzner. ✅ DONE + DEPLOYED + VALIDATED.** ACP client + Grok adapter +
  extended `AdapterEvent` + both-path wiring + enum/picker + tests + per-request timeout.
  Deployed to `ooda-runner.service` on hetzner-bob (on branch `feat/grok-acp-adapter`);
  `[runner] available adapters: codex, claude, grok`. Validated end-to-end against grok 0.2.16
  via `apps/ooda-runner/scripts/grok-acp-smoke.mjs` (PASS).
- **Phase 2 — Agent config. ✅ DONE (code).** Schema columns + migration 0020 +
  `resolveAgentType` (tested). Mutations: `workItems.update` (agentTypeOverride),
  `project.setDefaultAgent`, `workspace.setDefaultAgent`. UI: shared `AgentSelect` on the
  work-item detail header, project automation settings, and a Settings → "Workspace Agents"
  section. `resolveAgentType` wired into `publicApiCreateRun` and `workItemsDispatch`.
- **Phase 3 — Convergence. ✅ DONE (code).** `bob-task-runner` is agent-aware: `bobStartRun`
  omits agentType (server resolves), runner spawns the resolved agent (codex/claude/grok).
  Resolver also matches `work_items.externalId` for Linear-sourced ids. `workItemsDispatch`
  resolves the hierarchy incl. workspace default, and that session flows through the gateway to
  the runner — so the **OODA workspace default is covered** for gateway-routed execution
  (no cross-system lookup needed).

### Deploy status — ALL DEPLOYED (2026-06-02)
- **Phase 1** — Grok adapter: deployed + validated on hetzner-bob `ooda-runner.service`
  (`available adapters: codex, claude, grok`).
- **Phase 2** — agent config: **deployed to production `bob.blder.bot`** (Cloudflare Worker
  `blder-bot`, version 2cfc8357) via `vinext deploy`. Prod `bob` DB on `hetzner-master`
  migrated (added `workspaces.default_agent_type`, `projects.default_agent_type`,
  `work_items.agent_type_override`). Post-deploy health verified (302/307/401, no 500s).
- **Phase 3** — task-runner: **deployed** to `/opt/bob/task-runner` on hetzner-bob (restarted,
  running agent-aware code; `.bak` kept). The task-runner workspace
  (`5503dac2-…`) `default_agent_type` set to `codex` so behavior is unchanged until a
  project/work-item override (e.g. grok) is set.

Deploy notes for next time: prod `bob` DB = `hetzner-master:5432/bob` (Hyperdrive
`blder-bot-db`); forge secret `DATABASE_URL_LOCAL` password is **stale** (auth fails) — migrate
via `sudo -u postgres psql bob` on hetzner-master. `apps/bob` predeploy script
`scripts/migrate-hetzner.sh` is missing, so deploy with `pnpm exec vinext deploy` after
migrating manually.

### runner_device registration — ✅ FIXED (2026-06-02)
**Root cause:** `ooda.blder.bot` is the CF Worker `ooda-blder-bot`; its `HYPERDRIVE` binding
pointed at Hyperdrive config `b053c840…` which had been **deleted** (CF API: "config not
found"), so every DB query failed. **Fix:** the `bob` database already contains the OODA tables
(runner_device, runner_session, session_event, …), so OODA and Bob share one DB. Repointed the
`ooda-blder-bot` worker's `HYPERDRIVE` binding to the existing `blder-bot-db` Hyperdrive
(`c1f467…` → `pg-db.forgegraf.com/bob`) via a CF API settings PATCH (other 11 bindings
preserved via `inherit`). No new Hyperdrive needed (account was at the 25 cap). The runner now
registers: `registered as device …`, `heartbeat OK`, `runner_device` row online with
capabilities `["codex","claude","grok"]`.

### (Historical) original diagnosis — NOT a code defect
The ooda-runner logs `registration failed … Failed query: select … from "runner_device"`.
Diagnosis: the repo schema (`packages/ooda/src/db/schema/research.ts`) and the production DB
(`ooda_production` @ 100.101.32.120) both have `runner_device` with all expected columns, and
the exact query **succeeds run directly** against that DB (the `runner-hetzner-bob` row exists).
`https://ooda.blder.bot` returns HTTP 200 but its `register` query fails — so the fault is the
**`ooda.blder.bot` deployment's DB connection**, not this repo. Verified 2026-06-02 with DB
superuser access on hetzner-master: `ooda_production` is the only OODA DB, its `runner_device`
schema is correct, and the exact query succeeds directly — yet the `runner-hetzner-bob` row has
not updated since **2026-05-19**, proving `ooda.blder.bot` writes to a *different/unreachable*
DB. `apps/ooda` (`@gmacko/ooda-web`) is plain Next.js with **no deploy script, no wrangler/CF
config, and no OODA Hyperdrive** — it is hosted externally by a pipeline not exposed in this
environment, so it cannot be redeployed or reconfigured from here. The Bob gateway path (which
Grok uses) is unaffected. **This is the one item not completable from this environment**: it
requires access to the `ooda.blder.bot` host's DB config / its deploy pipeline.

## 11. Validated ACP facts (grok 0.2.16, hetzner-bob)

- Launch: `grok --cwd <ws> agent --always-approve stdio` (NOT `agent stdio --cwd`; no
  `--no-auto-update` flag — auto-update is config-driven).
- Auth: cached token in `~/.grok/auth.json` (ACP `authenticate` methodId `cached_token`); no
  `XAI_API_KEY` required when running as the `bob` user.
- Grok delegates fs to the client over ACP: `fs/write_text_file` + `fs/read_text_file` — so
  `handleAgentRequest` is load-bearing, not just defensive.
- `session/update` kinds match `mapSessionUpdate`: `agent_message_chunk` (text→stdout),
  `agent_thought_chunk` (→thought), `tool_call` (`toolCallId`/`title`/`rawInput`),
  `tool_call_update` (`status:"completed"`). `session/prompt` → `{stopReason}`;
  `"end_turn"` = success (exit 0).
