# Phase 7B-4D-beta: Handler Extraction for All Routers

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract business logic from all 34 remaining tRPC routers into standalone handler functions, rewrite routers as thin facades, and create Effect-RPC handler factories — scaling the pattern proven in 7B-4D-alpha (snapshot).

**Architecture:** Each router gets 3 files: `handlers/<name>.ts` (pure logic), `router/<name>.ts` (tRPC facade), `rpc-handlers/<name>.ts` (Effect-RPC bridge). Existing tests must continue passing unchanged — handler extraction is a refactor, not a behavior change.

**Tech Stack:** TypeScript, tRPC, Effect, Zod, Drizzle ORM

---

## Reference Pattern (from alpha — snapshot)

**Handler** (`handlers/snapshot.ts`): Exports async functions taking `HandlerContext` + typed input, returning Promise. Contains all business logic, DB queries, error throws.

**Facade** (`router/snapshot.ts`): `satisfies TRPCRouterRecord`. Each procedure's body is a one-line call to the handler: `({ ctx, input }) => handlerFn({ db: ctx.db, userId: ctx.session.user.id }, input)`.

**RPC Handler** (`rpc-handlers/snapshot.ts`): Factory `makeXxxRpcHandlers(ctx)` returning object keyed by RPC name (e.g. `"planning.snapshot.create"`), each calling `wrapHandler(handlerFn, ctx, payload, entityName)`.

## HandlerContext Update

The current `HandlerContext` has `userId: string` (required). Some routers use `publicProcedure` (no session) or `apiKeyReadProcedure`/`apiKeyWriteProcedure`. Update:

```ts
export interface HandlerContext {
  readonly db: any;
  readonly userId: string;
}

export interface PublicHandlerContext {
  readonly db: any;
  readonly session: { user: { id: string } } | null;
}
```

Routers using public/apiKey procedures: auth, cookies, post, publicApi, secrets, system, workItems.

## Router Batches

| Batch | Routers | Procedures | Task |
|-------|---------|------------|------|
| A (Tiny) | auth(2), capture(2), system(2), agentRun(3), checkpoint(3), post(4), workspace(4) | 20 | 2 |
| B (Small) | cookies(5), event(5), requirement(5), terminal(5), project(6), skill(6) | 32 | 3 |
| C (Med-1) | featureBranch(7), git(7), gitProviders(6), chat(8) | 28 | 4 |
| D (Med-2) | dispatch(8), link(8), secrets(8), settingsEdge(8), webhook(8) | 40 | 5 |
| E (Med-3) | instance(9), filesystem(9), publicApi(9), plan(11) | 38 | 6 |
| F (Large-1) | pullRequest(12), repository(12), settings(13) | 37 | 7 |
| G (Large-2) | forgegraph(14), planSession(15) | 29 | 8 |
| H (XL-1) | workItems(19), planning(21) | 40 | 9 |
| I (XL-2) | session(28) | 28 | 10 |
| **Total** | **34 routers** | **292** | |

---

### Task 1: Update HandlerContext + add PublicHandlerContext

**Files:**
- Modify: `packages/bob/src/api/src/handlers/context.ts`

**Step 1: Add PublicHandlerContext type**

```ts
export interface HandlerContext {
  readonly db: any;
  readonly userId: string;
}

export interface PublicHandlerContext {
  readonly db: any;
  readonly session: { user: { id: string } } | null;
}
```

**Step 2: Verify existing tests still pass**

Run: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`
Expected: All pass (382 pass, 1 skipped baseline)

**Step 3: Commit**

```bash
git add packages/bob/src/api/src/handlers/context.ts
git commit -m "feat(bob/api): add PublicHandlerContext for unauthenticated routes (7B-4D-beta Task 1)"
```

---

### Task 2: Batch A — Tiny routers (7 routers, 20 procedures)

**Routers:** auth(2), capture(2), system(2), agentRun(3), checkpoint(3), post(4), workspace(4)

**Files per router:**
- Create: `packages/bob/src/api/src/handlers/<name>.ts`
- Modify: `packages/bob/src/api/src/router/<name>.ts`
- Create: `packages/bob/src/api/src/rpc-handlers/<name>.ts`

**Step 1: For each router, read the source, extract handler functions**

For each router file in `packages/bob/src/api/src/router/`:
1. Read the file completely
2. Create `handlers/<name>.ts`: Move all business logic into exported async functions. Each function takes `HandlerContext` (or `PublicHandlerContext` for public procedures) + typed input params. Move helper functions and imports too.
3. Rewrite `router/<name>.ts` as a thin facade: Keep `satisfies TRPCRouterRecord`, keep Zod `.input()` validation, but body becomes one-line delegation to handler.
4. Create `rpc-handlers/<name>.ts`: Export `make<Name>RpcHandlers(ctx)` factory. Each key is the RPC name from the contracts (e.g. `"auth.getSession"`). Each value calls `wrapHandler`.

RPC name mapping — use the contract namespace from packages/bob/src/contracts/groups/:
- auth → `auth.*`
- capture → derive from procedure names
- system → derive from procedure names
- agentRun → `workItem.taskRun.*` (agent runs are task runs)
- checkpoint → `planning.checkpoint.*`
- post → derive from procedure names
- workspace → derive from procedure names

**Step 2: Run tests to verify nothing broke**

Run: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`
Expected: All existing tests pass unchanged

**Step 3: Commit**

```bash
git add packages/bob/src/api/src/handlers/ packages/bob/src/api/src/router/ packages/bob/src/api/src/rpc-handlers/
git commit -m "refactor(bob/api): extract handlers for tiny routers — auth, capture, system, agentRun, checkpoint, post, workspace (7B-4D-beta Task 2)"
```

---

### Task 3: Batch B — Small routers (6 routers, 32 procedures)

**Routers:** cookies(5), event(5), requirement(5), terminal(5), project(6), skill(6)

**Same 3-file pattern per router as Task 2.**

RPC name mapping:
- cookies → derive from procedure names
- event → derive from procedure names
- requirement → `workItem.requirement.*`
- terminal → derive from procedure names
- project → derive from procedure names
- skill → `planning.skill.*`

**Step 1:** Read each router, create handlers, rewrite facades, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for small routers — cookies, event, requirement, terminal, project, skill (7B-4D-beta Task 3)"
```

---

### Task 4: Batch C — Medium routers 1 (4 routers, 28 procedures)

**Routers:** featureBranch(7), git(7), gitProviders(6), chat(8)

**Same 3-file pattern per router.**

**Step 1:** Read each router, extract handlers, rewrite facades, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for medium routers — featureBranch, git, gitProviders, chat (7B-4D-beta Task 4)"
```

---

### Task 5: Batch D — Medium routers 2 (5 routers, 40 procedures)

**Routers:** dispatch(8), link(8), secrets(8), settingsEdge(8), webhook(8)

**Same 3-file pattern per router.**

RPC name mapping:
- dispatch → `planning.dispatch.*`
- link → `workItem.link.*`
- secrets → `secrets.*` (platform namespace)
- settingsEdge → `settings.*` (edge variant)
- webhook → `external.webhook.*`

**Step 1:** Read, extract, rewrite, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for medium routers — dispatch, link, secrets, settingsEdge, webhook (7B-4D-beta Task 5)"
```

---

### Task 6: Batch E — Medium routers 3 (4 routers, 38 procedures)

**Routers:** instance(9), filesystem(9), publicApi(9), plan(11)

**Same 3-file pattern per router.**

RPC name mapping:
- publicApi → `external.publicApi.*`
- plan → `planning.plan.*` or derive from procedure names

**Step 1:** Read, extract, rewrite, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for medium routers — instance, filesystem, publicApi, plan (7B-4D-beta Task 6)"
```

---

### Task 7: Batch F — Large routers 1 (3 routers, 37 procedures)

**Routers:** pullRequest(12), repository(12), settings(13)

**Same 3-file pattern per router.**

RPC name mapping:
- settings → `settings.*`
- pullRequest, repository → derive from procedure names

**Step 1:** Read, extract, rewrite, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for large routers — pullRequest, repository, settings (7B-4D-beta Task 7)"
```

---

### Task 8: Batch G — Large routers 2 (2 routers, 29 procedures)

**Routers:** forgegraph(14), planSession(15)

**Same 3-file pattern per router.**

RPC name mapping:
- forgegraph → `external.forgegraph.*`
- planSession → `planning.session.*`

**Step 1:** Read, extract, rewrite, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for large routers — forgegraph, planSession (7B-4D-beta Task 8)"
```

---

### Task 9: Batch H — XL routers 1 (2 routers, 40 procedures)

**Routers:** workItems(19), planning(21)

These are the two largest routers (937 and 1211 lines). Extra care needed:

- `workItems.ts` uses `apiKeyReadProcedure`, `apiKeyWriteProcedure`, and `protectedProcedure` — handler functions need appropriate context types
- `workItems.ts` has ForgeGraph integration (dual-source reads) — keep that logic in handlers
- `planning.ts` has complex session/plan state management — extract as-is

**Same 3-file pattern per router.**

**Step 1:** Read, extract, rewrite, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for XL routers — workItems, planning (7B-4D-beta Task 9)"
```

---

### Task 10: Batch I — XL router 2 (1 router, 28 procedures)

**Router:** session(28) — 1196 lines, largest single router

`session.ts` has:
- Complex bootstrap flows
- Linked task management
- Chat conversation handling
- Multiple helper functions

**Same 3-file pattern.**

**Step 1:** Read, extract, rewrite, create rpc-handlers.

**Step 2:** Run tests: `cd packages/bob/src/api && pnpm exec vitest run --no-file-parallelism`

**Step 3:** Commit:
```bash
git commit -m "refactor(bob/api): extract handlers for session router (7B-4D-beta Task 10)"
```

---

### Task 11: Barrel exports + full verification

**Files:**
- Create: `packages/bob/src/api/src/handlers/index.ts`
- Create: `packages/bob/src/api/src/rpc-handlers/index.ts`

**Step 1: Create handler barrel export**

Export all handler modules from `handlers/index.ts`.

**Step 2: Create rpc-handlers barrel export**

Export all `make*RpcHandlers` factories from `rpc-handlers/index.ts`.

**Step 3: Run full test suite**

```bash
cd /path/to/worktree && pnpm exec turbo run test --concurrency=1 -- --no-file-parallelism
```

Expected:
- Core: 458 tests pass
- Bob contracts: 46 tests pass
- Bob API: 382+ tests pass, 1 skipped

**Step 4: Count verification**

Count handler files (should be 35 = 34 new + snapshot), rpc-handler files (35), and that all routers are now facades.

**Step 5: Commit**

```bash
git commit -m "feat(bob/api): barrel exports + verification for all handler extractions (7B-4D-beta Task 11)"
```

---

## Key Rules for All Tasks

1. **Never change behavior.** This is pure refactoring. Every existing test must pass unchanged.
2. **Keep Zod schemas in the facade.** The tRPC router keeps `.input()` validation — handlers receive already-validated data.
3. **Move ALL business logic.** The facade body should be one line: a call to the handler function.
4. **Move helpers too.** If a router has private helper functions, move them to the handler file.
5. **Preserve imports.** Handler files import from `@bob/db`, `@bob/db/schema`, etc. — the same imports the router had.
6. **Public procedures:** Use `PublicHandlerContext` for handlers that don't require authentication. The facade constructs it as `{ db: ctx.db, session: ctx.session }`.
7. **API key procedures:** Same as protected — they have `ctx.session.user.id`. Use `HandlerContext`.
8. **RPC name mapping:** Use the contract namespace. If unsure, derive from router name + procedure name (e.g., `cookies.save` → `"cookies.save"`). The gamma phase will wire these to actual contracts.
