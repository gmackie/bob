# Phase 7B-4 — Bob Domain Services Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Migrate Bob's 349 tRPC procedures across 35 routers onto Effect-RPC. Contracts-first approach — all contracts and schemas defined up front, then handlers implemented, then tRPC routers rewired as thin facades.

**Branch:** `phase-7b-4-domain-services`
**Base:** `master` (post 7B-3 merge)

---

## Decisions (from brainstorming)

- **Full sweep**: All 35 routers, 349 procedures migrated in one phase.
- **Contracts-first**: Define all `Rpc.make()` contracts + Schema types up front, then implement handlers.
- **Hybrid placement**: Shared platform contracts in `@gmacko/core/contracts`, Bob-specific domain contracts in `@gmacko/bob/contracts`.
- **7 RpcGroups**: Auth, Agent, Project, Settings (→ core), WorkItems, Planning, External (→ bob).
- **Extend existing contracts**: Bob's wider API extends gmacko's existing 27 RPC procedures. Platform contracts are designed as the target unified API (for both Bob and OODA), not just a translation of Bob's tRPC.
- **Thin wrappers for Bob-specific**: Platform handlers (core) use full Effect services. Bob-specific handlers use thin wrappers calling existing Bob logic.
- **tRPC facade**: Existing tRPC routers become thin delegates to Effect-RPC handlers. 370 tests keep passing through tRPC throughout. Effect-RPC endpoint runs in parallel at `/api/rpc`.

---

## Constraints

- Bob's 370 API tests must stay at 370 passed | 1 skipped throughout.
- `@gmacko/core` tests stay 347/347.
- `apps/core` smoke tests stay 9/9.
- Existing gmacko RPC clients must keep working (no breaking changes to existing 27 contracts).
- Bob's Vite app keeps using tRPC client until a separate client migration pass.

---

## Contract Placement

### `packages/core/src/contracts/groups/` (platform — shared by Bob + OODA)

| Group | Existing | Adding from Bob | Total |
|-------|----------|-----------------|-------|
| Auth | 9 | ~8 | ~17 |
| Agent | 5 | ~75 | ~80 |
| Project | 4 | ~55 | ~59 |
| Settings | 0 (secrets: 6) | ~35 | ~41 |

### `packages/bob/src/contracts/groups/` (Bob-specific domain)

| Group | Procedures |
|-------|-----------|
| WorkItems | ~65 |
| Planning | ~70 |
| External | ~35 |

---

## RpcGroup Namespaces

### Agent (core) — extends existing `AgentRpc`

Keep gmacko's 5 session lifecycle RPCs. Add Bob's operational RPCs:

- `agent.createSession`, `agent.sendTurn`, `agent.closeSession`, `agent.cancelSession`, `agent.getTranscript` (existing)
- `agent.run.list`, `agent.run.get`, `agent.run.listByWorkItem`
- `agent.session.*` — 29 procedures: leases, voice, workflow state, events, status (merges Bob's `session` router)
- `agent.instance.*` — 9 procedures: lifecycle, worktree binding
- `agent.terminal.*` — 5 procedures: session types, listing
- `agent.filesystem.*` — 10 procedures: CRUD, git status, search
- `agent.event.*` — 5 procedures: activity, stats
- `agent.capture.*` — 2 procedures

### Project (core) — extends existing `ProjectsRpc`

Keep gmacko's 4 project CRUD RPCs. Add:

- `project.discovery`, `project.updateAutomationSettings`, `project.dismissDir`
- `project.workspace.*` — 4 procedures: CRUD
- `project.repository.*` — 12 procedures: add, worktrees, refresh
- `project.pullRequest.*` — 12 procedures: CRUD, reviews, sync
- `project.featureBranch.*` — 7 procedures: lifecycle, PR linking
- `project.gitProvider.*` — 6 procedures: PAT, connections
- `project.git.*` — 7 procedures: jj commands, push

### Settings (core) — new group

- `settings.general.*` — from settings + settingsEdge routers (~23 procedures)
- `settings.cookies.*` — from cookies router (~5 procedures)
- `settings.system.*` — from system router (~3 procedures)
- Secrets: extend existing `SecretsRpc` (6) with Bob's additions (~3 extra)

### Auth (core) — extends existing `AuthRpc`

Keep gmacko's 9 auth RPCs. Add Bob's:

- `auth.getSession`, `auth.signOut` (from Bob's auth router)
- Plus any Bob-specific auth utilities

### WorkItems (bob) — faithful translation

- `workItem.*` — CRUD, status, assignments
- `workItem.comment.*` — threaded comments
- `workItem.activity.*` — activity feed
- `workItem.artifact.*` — attachments
- `workItem.taskRun.*` — agent task tracking
- `workItem.notification.*` — alerts
- `workItem.requirement.*` — acceptance criteria
- `workItem.link.*` — cross-item relationships

### Planning (bob) — faithful translation

- `planning.*` — top-level planning procedures (22)
- `planning.session.*` — session lifecycle (16)
- `planning.task.*` — plan/task CRUD (12)
- `planning.dispatch.*` — batch dispatch (16)
- `planning.skill.*` — skill templates (9)
- `planning.snapshot.*` — snapshots
- `planning.checkpoint.*` — checkpoints

### External (bob) — faithful translation

- `external.forgegraph.*` — ForgeGraph deployment API (15)
- `external.webhook.*` — webhook management (9)
- `external.publicApi.*` — public-facing endpoints, API-key-scoped (12)

---

## Contract Pattern

```ts
// packages/bob/src/contracts/groups/work-items.ts
import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

export const WorkItemListRpc = Rpc.make("workItem.list", {
  payload: Schema.Struct({ projectId: Schema.String }),
  success: Schema.Array(WorkItemSchema),
  error: Schema.Union(UnauthorizedError, ProjectNotFoundError),
})

export const WorkItemsRpc = RpcGroup.make(
  WorkItemListRpc,
  WorkItemCreateRpc,
  // ...
)
```

Schemas live in sibling files: `../schemas/work-items.ts`.

Naming: `<domain>.<verb>` — dots create client namespacing.

Error types: `Schema.TaggedError` per group, reusable across contracts.

Auth level: Encoded in contract metadata. `AuthMiddleware` reads it to enforce access control.

---

## Handler Patterns

### Platform handlers (Effect services)

```ts
// packages/core/src/agent/rpc-handlers.ts
import { Effect } from "effect"
import { AgentInstanceStartRpc } from "@gmacko/core/contracts"
import { Agent } from "./service"

export const agentInstanceStartHandler = RpcHandler.make(
  AgentInstanceStartRpc,
  ({ payload }) =>
    Effect.gen(function* () {
      const agent = yield* Agent
      return yield* agent.startInstance(payload)
    }),
)
```

### Bob-specific handlers (thin wrappers)

```ts
// packages/bob/src/api/src/handlers/work-items.ts
import { db } from "@bob/db/client"
import { workItems } from "@bob/db/schema"

export const workItemHandlers = {
  list: async (ctx, input) => {
    // Business logic extracted from tRPC procedure
    return db.select().from(workItems).where(...)
  },
  create: async (ctx, input) => { ... },
}
```

### tRPC facade

```ts
// packages/bob/src/api/src/router/workItems.ts (after migration)
export const workItemRouter = {
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => workItemHandlers.list(ctx, input)),
}
```

Both tRPC facade and Effect-RPC handler call the same handler function.

---

## Server Wiring

`apps/bob` mounts both endpoints:

- `/api/trpc` — existing tRPC (facades delegating to handlers)
- `/api/rpc` — new Effect-RPC (handlers directly)

```ts
// apps/bob — Effect-RPC route
const serverLayer = RpcServer.layerHttp({
  group: BobServerGroup, // merged platform + bob groups
  path: "/api/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(allHandlers),
  Layer.provide(authMiddlewareLayer),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(runtimeLayer),
)
```

---

## Task Breakdown

### Phase A: Scaffolding

#### Task 1: Bob contracts package structure

Create `packages/bob/src/contracts/` with:
- `index.ts` — barrel
- `groups/` — empty group files
- `schemas/` — empty schema files
- `errors.ts` — Bob-specific tagged errors

Add `./contracts` export to `packages/bob/package.json`.

#### Task 2: Effect-RPC server mount in apps/bob

Set up `/api/rpc` endpoint in `apps/bob` alongside existing `/api/trpc`.
Empty handler set initially — just prove the mount works.

#### Task 3: Handler utilities

Create shared helpers:
- ctx-to-Effect bridge (extract user/db from tRPC ctx for handler reuse)
- Error mapping (tRPC errors ↔ Effect tagged errors)
- Auth level annotation helpers

### Phase B: Platform contracts in core (design target API)

#### Task 4: Agent contracts

Extend `packages/core/src/contracts/groups/agent.ts`:
- Keep existing 5 RPCs
- Add ~75 new RPCs across `agent.run.*`, `agent.session.*`, `agent.instance.*`, `agent.terminal.*`, `agent.filesystem.*`, `agent.event.*`, `agent.capture.*`
- Define schemas in `packages/core/src/contracts/schemas/`

Reference Bob's routers: `agentRun.ts`, `session.ts`, `instance.ts`, `terminal.ts`, `filesystem.ts`, `event.ts`, `capture.ts`

#### Task 5: Project contracts

Extend `packages/core/src/contracts/groups/projects.ts`:
- Keep existing 4 RPCs
- Add ~55 new RPCs across `project.workspace.*`, `project.repository.*`, `project.pullRequest.*`, `project.featureBranch.*`, `project.gitProvider.*`, `project.git.*`
- Define schemas

Reference Bob's routers: `project.ts`, `workspace.ts`, `featureBranch.ts`, `repository.ts`, `pullRequest.ts`, `gitProviders.ts`, `git.ts`

#### Task 6: Settings contracts

Create `packages/core/src/contracts/groups/settings.ts`:
- ~35 new RPCs across `settings.general.*`, `settings.cookies.*`, `settings.system.*`
- Extend existing `SecretsRpc` with Bob's extras
- Define schemas

Reference Bob's routers: `settings.ts`, `settingsEdge.ts`, `cookies.ts`, `secrets.ts`, `system.ts`

#### Task 7: Auth contracts

Extend `packages/core/src/contracts/groups/auth.ts`:
- Keep existing 9 RPCs
- Add ~8 from Bob's auth router
- Define schemas

Reference Bob's router: `auth.ts`

### Phase C: Bob-specific contracts (faithful translation)

#### Task 8: WorkItems contracts

Create `packages/bob/src/contracts/groups/work-items.ts`:
- ~65 RPCs across `workItem.*`, `workItem.comment.*`, `workItem.activity.*`, `workItem.artifact.*`, `workItem.taskRun.*`, `workItem.notification.*`, `workItem.requirement.*`, `workItem.link.*`
- Define schemas in `packages/bob/src/contracts/schemas/`

Reference Bob's router: `workItems.ts` (937 lines — the largest), `requirement.ts`, `link.ts`

#### Task 9: Planning contracts

Create `packages/bob/src/contracts/groups/planning.ts`:
- ~70 RPCs across `planning.*`, `planning.session.*`, `planning.task.*`, `planning.dispatch.*`, `planning.skill.*`, `planning.snapshot.*`, `planning.checkpoint.*`
- Define schemas

Reference Bob's routers: `planning.ts`, `planSession.ts`, `plan.ts`, `dispatch.ts`, `skill.ts`, `snapshot.ts`, `checkpoint.ts`

#### Task 10: External contracts

Create `packages/bob/src/contracts/groups/external.ts`:
- ~35 RPCs across `external.forgegraph.*`, `external.webhook.*`, `external.publicApi.*`
- Define schemas

Reference Bob's routers: `forgegraph.ts`, `webhook.ts`, `publicApi.ts`

### Phase D: Handlers + facade

#### Task 11: Platform handlers

Implement Effect-service-based handlers for Agent, Project, Settings, Auth.
Extend existing gmacko services where needed. Wire into the Effect-RPC server group.

#### Task 12: Bob-specific handlers

Extract business logic from tRPC procedures into handler functions.
Wire as thin wrappers for WorkItems, Planning, External.
Wire into the Effect-RPC server group.

#### Task 13: tRPC facade rewiring

Rewire all 35 tRPC routers to delegate to handler functions.
Verify 370 tests still pass through the facade.

#### Task 14: Final verification + doc

Full test sweep. Verify Effect-RPC endpoint is live.
Write completion doc to `docs/plans/phase-7b-4/`.

---

## Risk / Unknowns

- **Schema translation**: Converting Zod schemas (tRPC) to Effect Schema types for 349 procedures is mechanical but voluminous. Some complex Zod schemas (discriminated unions, transforms) may need careful manual translation.
- **Streaming procedures**: Bob's `session.getEvents` and similar may need `stream: true` in the contract. Identify streaming procedures during contract definition.
- **CF Workers compatibility**: Effect-RPC + `ManagedRuntime` hasn't been tested in Bob's Vite + CF Workers stack. May need a lighter bridge for `apps/bob` if running on Workers.
- **OODA overlap**: Platform contracts are designed for the unified API, but OODA's exact requirements aren't fully specified yet. Contracts may need revision when OODA lands in 7C.
- **Contract count may differ**: The ~349 estimate is based on procedure counts in tRPC. Some procedures may merge, split, or be removed during target API design. Final count will be determined during Tasks 4-10.
