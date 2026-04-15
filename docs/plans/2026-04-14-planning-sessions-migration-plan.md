# Planning Sessions Migration Plan

**Date:** 2026-04-14
**Owner:** Bob Builder team
**Depends on:** ws-gateway migration Phases 1–4 (complete)
**Unblocks:** ws-gateway migration Phase 5 (delete `apps/gateway/` + `apps/execution/`)

## Goal

Move planning sessions off the old `apps/gateway` + `apps/execution` stack onto the new ws-gateway + Go daemon path so we can delete the old stack entirely. After this lands, the only runtime paths into session execution are:

```
Browser ──wss──► ws-gateway ◄──wss── Go daemon ──spawns──► claude (+ MCP tools)
```

No more in-process agent orchestration on the Node server.

## Why now

- `apps/gateway` + `apps/execution` are ~3k LOC of TS session-management code that duplicates what the Go daemon now does.
- Every ws-gateway improvement (liveness pings, reconnect, scheduling) has to be re-implemented in the old gateway too, or it bitrots.
- `packages/api/src/router/planSession.ts` dynamically imports `@bob/execution/planning/startPlanningSession` (line 192) and `@bob/execution/runtime/taskExecutor` (via `pipelineOrchestrator.ts:200`). That dynamic-import coupling blocks us from deleting `apps/execution`.
- ws-gateway migration Phase 5 is stuck until this lands.

## Scope

**In scope:**
- Make planning sessions runnable end-to-end on the ws-gateway + Go daemon path.
- Preserve the current UX: user launches a planning session from the workflow modal, sees drafts appear in the UI, can commit them to work items.
- Keep the existing schema (`chatConversations`, `planDrafts`, `planDraftDependencies`, `workItemArtifacts`) unchanged — only the execution path moves.

**Out of scope:**
- `smol-agent` support. Drop it; planning goes claude-only. Labnuc doesn't have smol-agent installed anyway, and we've never validated the fallback chain in production.
- Review profiles (`smolAgentReviewProfile.ts`) — those are used by `/review` workflow, not planning. They need a separate migration and are not blocking Phase 5 until we delete `apps/execution` (which is a later sub-step of Phase E below).
- Live agent stdout streaming into the planning UI. Today's UI polls `planSession.get()` for drafts and doesn't show agent thinking. We keep that behavior.

## High-level architecture

```
┌─────────────┐            ┌─────────────┐        ┌────────────────┐        ┌──────────────┐
│   Browser   │──tRPC────►│ blder.bot   │──WS───►│  ws-gateway    │◄──WS──│  Go daemon   │
│  /plan UI   │  start    │   Workers   │ nudge  │ (hetzner)      │        │  (labnuc)    │
└─────────────┘            │             │        │                │        │              │
       ▲                   │ - planSess  │        │ - pending queue│        │ - spawns     │
       │ poll              │   router    │        │ - session state│        │   claude     │
       └───────tRPC────────┤ - plan-tools│◄──────────────HTTP──────────────┤ - spawns     │
              drafts       │   REST      │        (tool callbacks)         │   MCP server │
                           └─────────────┘                                 └──────────────┘
```

The agent calls the five planning tools via MCP → the daemon-spawned MCP server → HTTP back to `blder.bot/api/v1/plan-tools/*` → DB writes. The browser polls drafts via `planSession.get()` as it does today.

## Phases

### Phase A — Plan-tools REST API on blder.bot

**Goal:** Expose the five planning tools as authenticated REST endpoints so any HTTP caller (MCP server, test fixture, future web UI) can hit them.

**Files to add:**
- `apps/blder/src/app/api/v1/plan-tools/create-draft/route.ts`
- `apps/blder/src/app/api/v1/plan-tools/update-draft/route.ts`
- `apps/blder/src/app/api/v1/plan-tools/remove-draft/route.ts`
- `apps/blder/src/app/api/v1/plan-tools/set-dependency/route.ts`
- `apps/blder/src/app/api/v1/plan-tools/remove-dependency/route.ts`
- `apps/blder/src/app/api/v1/plan-tools/list-drafts/route.ts`

**Pattern:** Thin wrappers over existing tRPC procedures in `packages/api/src/router/planSession.ts` (lines 404–502). Use `createPublicApiCaller(request)` from `apps/blder/src/lib/rest/api-helpers.ts` — same pattern as the heartbeat endpoint we already fixed. Auth via `Authorization: Bearer bob_...` (daemon API key, already validated by `packages/auth/src/api-key.ts`).

**Session ownership check:** Every endpoint must verify that the API key's owner also owns the `sessionId` being mutated. `loadOwnedPlanningSession` (planSession.ts:~70) already does this — expose it or inline the same check. A hostile daemon must not be able to write drafts into another user's session.

**Request/response shapes:** Match the tRPC input/output schemas 1:1. Zod-validate inputs at the route level. Return JSON that mirrors the tRPC procedure's return type.

**Tests:**
- `apps/blder/src/app/api/v1/plan-tools/__tests__/create-draft.test.ts` — valid + unauthorized + cross-session attempt.
- One contract test per endpoint is enough; the underlying logic is already tested under `packages/api`.

**Done when:** `curl -H "Authorization: Bearer bob_..." -d '{...}' https://blder.bot/api/v1/plan-tools/create-draft` creates a row in `plan_drafts` that shows up in the current planning UI on refresh.

**Estimate:** 1–2 days. Zero risk — pure addition, nothing breaks.

---

### Phase B — Planning MCP server

**Goal:** Give the claude agent a stdio MCP server that exposes the five planning tools. Tool calls translate to HTTP against Phase A.

**Design decision:** Write the MCP server as a **Node CLI** (`packages/plan-mcp/`), not Go. Reasons:
1. The official MCP TypeScript SDK is more mature than Go alternatives.
2. The prompt + tool definitions are already TS (`apps/execution/src/planning/planningAgentTools.ts`) — we can port them as-is instead of rewriting.
3. We ship it as a single `node` script that the Go daemon spawns as a child process. No Go MCP dependency.
4. If performance ever matters, the rewrite to Go is ~500 LOC.

**Files to add:**
- `packages/plan-mcp/package.json` — `"name": "@bob/plan-mcp"`, `"bin": { "bob-plan-mcp": "./dist/cli.js" }`
- `packages/plan-mcp/src/cli.ts` — entry point, reads env (`BOB_API_URL`, `BOB_API_KEY`, `BOB_SESSION_ID`, `BOB_WORKSPACE_ID`, `BOB_PROJECT_ID`), constructs MCP server.
- `packages/plan-mcp/src/server.ts` — MCP server definition using `@modelcontextprotocol/sdk`. Registers the five tools with their schemas.
- `packages/plan-mcp/src/tools.ts` — ports the tool definitions from `apps/execution/src/planning/planningAgentTools.ts`. Each tool is a function that POSTs to the corresponding REST endpoint and returns the parsed response.
- `packages/plan-mcp/src/__tests__/tools.test.ts` — unit tests with a mocked fetch.
- `packages/plan-mcp/tsup.config.ts` — bundle to `dist/cli.js` as a single ESM file.

**Prompt location:** `buildPlanningPrompt` and `buildLaunchContextGuidance` move verbatim from `apps/execution/src/planning/planningAgentTools.ts` into `packages/plan-mcp/src/prompt.ts`. The Go daemon reads it at session start via a small `bob-plan-mcp print-prompt` subcommand that prints the rendered prompt to stdout given the context as JSON on stdin. (This avoids duplicating prompt logic in two languages.)

**Auth:** The daemon passes its `BOB_API_KEY` to the MCP server via env. The MCP server uses it as a bearer token for every HTTP call. The Phase A ownership check guarantees scope.

**Done when:** `echo '{...}' | bob-plan-mcp` responds to MCP `tools/list` and `tools/call` correctly, and `bob-plan-mcp print-prompt` emits the planning prompt for a given context.

**Estimate:** 2–3 days. Mostly porting existing TS + wiring MCP SDK.

---

### Phase C — Go daemon support for planning sessions

**Goal:** Teach the Go daemon to recognize a `sessionType: "planning"` session_available event, spawn claude with the planning MCP config, and stream events normally.

**ws-gateway changes** (`apps/ws-gateway/src/relay.ts`, `messages.ts`):
- Extend the `session_available` envelope with `sessionType` (`"agent_run" | "planning"`) and `planningContext` (workspaceId, projectId, projectName, sessionId, launchContext object).
- `planSession.start` (new behavior in Phase D) enqueues with `sessionType: "planning"` and `planningContext` populated.

**Go daemon changes** (`~/dev/bob-cli/`):
- `internal/ws/client.go` — extend `SessionAvailable` struct with `SessionType string` and `PlanningContext *PlanningContext`.
- `internal/session/planning.go` (new) — given a planning context, runs `bob-plan-mcp print-prompt` to get the prompt, writes an MCP config JSON to a tempfile pointing at `bob-plan-mcp` as a stdio server with the right env, and returns an `agent.Config` that launches `claude` with `--mcp-config <path>` and the prompt.
- `cmd/run_loop.go` — in `executeSession`, branch on `sa.SessionType`. If `"planning"`, call `session.PlanningConfig(...)` instead of `agentConfigFor`. Rest of the flow (streamer, artifacts, status updates) is unchanged.
- `cmd/start.go` — at startup, verify `bob-plan-mcp` is available on PATH (or at `/opt/bob/plan-mcp/dist/cli.js`). Log a warning if missing; planning sessions fail fast with a clear error.

**Lifecycle events:** The daemon writes `run_started` with `phase: "plan"` at session start (via `wsClient.SendSessionEvent` carrying an `event_type: "run_started"` payload). The ws-gateway persists it to `run_lifecycle_events` in the existing batch writer path. This replaces the current code path in `startPlanningSession.ts:106–126`.

**Claude invocation:** `claude --mcp-config <path> -p "<prompt>"`. **Not** `--print`. Planning needs interactive mode so tool calls can happen mid-conversation. Verify with a real session that stdin stays open.

**Deployment:** Add `bob-plan-mcp` to the labnuc setup — either `sudo npm install -g @bob/plan-mcp` from a published tarball, or ship it bundled with the daemon binary via a post-install step.

**Tests:**
- `~/dev/bob-cli/internal/session/planning_test.go` — table-driven test for MCP config file generation.
- Manual e2e: launch a planning session from the UI, watch drafts appear in the DB, verify the agent can chain multiple tool calls.

**Done when:** A planning session started via a direct `pending_sessions` row insert (bypassing `planSession.start` for now) runs to completion, generates drafts in the DB, and the UI renders them.

**Estimate:** 3–4 days.

---

### Phase D — Cut `planSession.start` over to ws-gateway

**Goal:** Remove the dynamic `@bob/execution` import from `packages/api/src/router/planSession.ts` and enqueue through ws-gateway instead.

**Changes in `packages/api/src/router/planSession.ts`:**
- Delete lines 191–193 (the `startPlanningSession` import).
- `start` mutation body becomes:
  1. Load + validate the session (already there).
  2. Build the `planningContext` object from session + project + launchContext.
  3. Call `ctx.db.insert(pendingSessions).values({ workspaceId, sessionId, sessionType: "planning", planningContext })`.
  4. POST the nudge to ws-gateway (shared-secret auth, same pattern as regular sessions).
  5. Update `chatConversations.status` to `"running"`.

**Schema change:** `pending_sessions` table (or whatever the ws-gateway pending queue uses) gets a nullable `planning_context` JSON column + `session_type` enum column. Migration file under `packages/db/migrations/`.

**Lifecycle event removal:** The `run_started` write at `startPlanningSession.ts:106–126` moves to the Go daemon (Phase C). Delete it from the Node side.

**pipelineOrchestrator.ts:** Line 200 imports `@bob/execution/runtime/taskExecutor`. This is used for non-planning task execution. Swap it for a ws-gateway enqueue too — but **scope-check first**: if `pipelineOrchestrator` isn't on any live code path today, we can delete the call instead of porting it. Investigate in Phase D kickoff. If it is live, its migration joins this phase; if not, it joins Phase E.

**Tests:**
- Update `packages/api/src/router/__tests__/planSession.test.ts` to mock the pending-session insert + nudge instead of the gateway HTTP call.
- Manual e2e: full round-trip from the UI launch modal to drafts appearing.

**Done when:** `packages/api` no longer imports anything from `@bob/execution`, and planning sessions still work end-to-end.

**Estimate:** 1–2 days. The risk is `pipelineOrchestrator` turning out to be load-bearing — if so, add 2–3 days to this phase.

---

### Phase E — Delete `apps/gateway` + `apps/execution`

**Goal:** Remove the old stack entirely.

**Files to delete:**
- `apps/gateway/` (whole directory)
- `apps/execution/` (whole directory)
- `packages/execution/` (the `@bob/execution-lib` — confirm it's unused after Phase D).

**Files to edit:**
- `pnpm-workspace.yaml` — remove if it explicitly lists either (currently uses `apps/*` glob, so nothing to edit).
- `package.json` — delete `dev:gateway`, `dev:web:gateway`, `dev:execution` scripts.
- `docker-compose.dev.yml` — remove gateway service block.
- `README.md` — remove `apps/gateway` and `apps/execution` bullet points from architecture list.
- `packages/api/package.json` — remove `@bob/execution` and `@bob/execution-lib` workspace deps.
- `packages/api/src/router/planSession.ts` — already cleaned in Phase D.
- `packages/api/src/services/forgegraph/pipelineOrchestrator.ts:200` — already cleaned in Phase D.
- Any `docs/plans/*.md` references — leave historical plans alone, they're records.

**Verification:**
- `pnpm install` clean.
- `turbo run build` clean across all remaining apps.
- `turbo run test` clean.
- `pnpm --filter @bob/blder build` produces a working Worker bundle.
- Deploy blder-bot, hit the planning UI, run a session.

**Estimate:** half a day if Phase D went clean.

## Rollout order and safety

Each phase is independently shippable and reversible until Phase E:

| Phase | Shippable alone? | Reversible? | Risk |
|-------|------------------|-------------|------|
| A | yes | yes (delete routes) | none — pure addition |
| B | yes | yes (delete package) | none — nothing consumes it yet |
| C | yes | yes (daemon branch is gated on sessionType) | low — old path still works |
| D | yes | yes (revert the router change) | medium — this is the cutover |
| E | yes | no (but git revert works) | low — just deletion |

Merge each phase to main as a separate PR. Run a real planning session end-to-end between D and E to prove the new path before deleting the old one.

## Open questions

1. **Auth model for plan-tools endpoints:** API key (user-scoped) or per-session JWT (session-scoped)? **Recommendation:** API key for v1, add JWT later if we ever expose plan-tools to untrusted daemons. The Phase A session-ownership check is enough for v1.

2. **MCP server packaging:** Global npm install vs bundled with the daemon? **Recommendation:** Global npm install for now. Simpler; matches how claude + codex are installed. Revisit if we ever want fully self-contained daemon deploys.

3. **`pipelineOrchestrator.ts:200` — live code path or dead?** Must be answered in Phase D kickoff. If dead, delete; if live, migration scope grows.

4. **Smol-agent on labnuc:** Drop support (recommendation) or install smol-agent and port the profiles? **Recommendation:** Drop. We've been running claude-only for a month without complaints.

5. **Phase 5 timing:** Do we ship Phase A–D behind a feature flag and cut over on one workspace first, or is the cutover atomic? **Recommendation:** Atomic. The old path stays functional through Phase D; a bad cutover means one `git revert` of the Phase D PR.

## Success criteria

- Planning sessions start, run, and commit to work items on the new path.
- `packages/api` has zero references to `@bob/execution` or `@bob/execution-lib`.
- `apps/gateway/` and `apps/execution/` are gone from the repo.
- `turbo run build` and `turbo run test` both pass across the monorepo.
- A user launches a planning session from the workflow modal, sees drafts appear in the UI, and commits them. No regressions.

## Estimate

- Phase A: 1–2 days
- Phase B: 2–3 days
- Phase C: 3–4 days
- Phase D: 1–2 days
- Phase E: 0.5 days

**Total: 7–12 days of focused work. ~2 weeks calendar.**
