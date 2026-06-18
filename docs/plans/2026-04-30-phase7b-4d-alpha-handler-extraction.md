# Phase 7B-4D-alpha — Handler Extraction Pattern + Proof-of-Concept

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the handler extraction pattern and prove it works end-to-end with the snapshot router (3 procedures). Both tRPC and Effect-RPC endpoints call the same handler functions. Bob's 370 tests stay green throughout.

**Architecture:** Extract business logic from tRPC procedures into standalone async handler functions. These functions accept a typed context (db + userId) and input, return data or throw. Both the tRPC procedure (facade) and the Effect-RPC handler (new) call the same function. The tRPC procedure becomes a thin facade — same input validation, same middleware, but delegates to the extracted handler.

**Tech Stack:** Effect 4.0.0-beta.43, `RpcGroup.toLayer()` from `effect/unstable/rpc`, existing Bob tRPC infrastructure.

---

## Handler Extraction Pattern

### Before (tRPC procedure owns business logic)

```ts
// packages/bob/src/api/src/router/snapshot.ts
export const snapshotRouter = {
  create: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid(), stage: z.string(), data: z.record(...) }))
    .mutation(async ({ ctx, input }) => {
      await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);
      const [snapshot] = await ctx.db.insert(workItemSnapshots).values({...}).returning();
      return snapshot;
    }),
};
```

### After (handler function + tRPC facade + Effect-RPC handler)

**Step 1: Extract handler function**

```ts
// packages/bob/src/api/src/handlers/snapshot.ts
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "@bob/db";
import { workItemSnapshots, workItems, workspaceMembers } from "@bob/db/schema";

export interface HandlerContext {
  readonly db: any;
  readonly userId: string;
}

async function assertWorkItemAccess(ctx: HandlerContext, workItemId: string) {
  const workItem = await ctx.db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });
  if (!workItem?.workspaceId) throw new TRPCError({ code: "NOT_FOUND" });
  const membership = await ctx.db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workItem.workspaceId),
      eq(workspaceMembers.userId, ctx.userId),
    ),
    columns: { id: true },
  });
  if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
  return workItem;
}

export async function snapshotCreate(
  ctx: HandlerContext,
  input: { workItemId: string; stage: string; data: Record<string, unknown> },
) {
  await assertWorkItemAccess(ctx, input.workItemId);
  const [snapshot] = await ctx.db
    .insert(workItemSnapshots)
    .values({ workItemId: input.workItemId, stage: input.stage, data: input.data })
    .returning();
  return snapshot;
}

export async function snapshotList(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await assertWorkItemAccess(ctx, input.workItemId);
  return ctx.db
    .select()
    .from(workItemSnapshots)
    .where(eq(workItemSnapshots.workItemId, input.workItemId))
    .orderBy(desc(workItemSnapshots.createdAt));
}

export async function snapshotGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  const rows = await ctx.db
    .select()
    .from(workItemSnapshots)
    .where(eq(workItemSnapshots.id, input.id))
    .limit(1);
  const snapshot = rows[0] ?? null;
  if (!snapshot) return null;
  await assertWorkItemAccess(ctx, snapshot.workItemId);
  return snapshot;
}
```

**Step 2: Rewrite tRPC router as facade**

```ts
// packages/bob/src/api/src/router/snapshot.ts (after)
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { protectedProcedure } from "../trpc";
import { snapshotCreate, snapshotList, snapshotGet } from "../handlers/snapshot";

export const snapshotRouter = {
  create: protectedProcedure
    .input(z.object({
      workItemId: z.string().uuid(),
      stage: z.string(),
      data: z.record(z.string(), z.unknown()),
    }))
    .mutation(({ ctx, input }) =>
      snapshotCreate({ db: ctx.db, userId: ctx.session.user.id }, input)),

  list: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      snapshotList({ db: ctx.db, userId: ctx.session.user.id }, input)),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      snapshotGet({ db: ctx.db, userId: ctx.session.user.id }, input)),
} satisfies TRPCRouterRecord;
```

**Step 3: Wire Effect-RPC handler**

```ts
// packages/bob/src/api/src/rpc-handlers/snapshot.ts
import { Effect } from "effect";
import { TRPCError } from "@trpc/server";
import { PlanningRpc } from "@gmacko/bob/contracts";
import { mapTrpcError } from "@gmacko/bob/contracts";
import { snapshotCreate, snapshotList, snapshotGet } from "../handlers/snapshot";
import type { HandlerContext } from "../handlers/snapshot";

// Bridge: wraps an async handler function into an Effect that catches TRPCError
function wrapHandler<I, O>(
  fn: (ctx: HandlerContext, input: I) => Promise<O>,
  ctx: HandlerContext,
  input: I,
) {
  return Effect.tryPromise({
    try: () => fn(ctx, input),
    catch: (error) => {
      if (error instanceof TRPCError) {
        return mapTrpcError(error.code, {
          entity: "snapshot",
          id: "unknown",
          message: error.message,
        });
      }
      return mapTrpcError("INTERNAL_SERVER_ERROR", { message: String(error) });
    },
  });
}

// The actual RPC handler layer — needs a HandlerContext from the middleware
export function snapshotRpcHandlers(ctx: HandlerContext) {
  return PlanningRpc.toLayerSubset({
    "planning.snapshot.create": ({ payload }) => wrapHandler(snapshotCreate, ctx, payload),
    "planning.snapshot.list": ({ payload }) => wrapHandler(snapshotList, ctx, payload),
    "planning.snapshot.get": ({ payload }) => wrapHandler(snapshotGet, ctx, payload),
  });
}
```

---

## Key Design Decisions

1. **`HandlerContext` is minimal** — just `db` and `userId`. Not tied to tRPC or Effect. Both callers construct it from their own context.

2. **Handlers throw TRPCError** — we keep the existing error type during extraction. The Effect-RPC bridge catches and maps them. This is a pragmatic choice: changing error handling in 308 handlers at the same time as extracting them is too risky. A follow-up pass can migrate to native Effect errors.

3. **`wrapHandler` bridge** — a single utility that wraps `(ctx, input) => Promise<T>` into `Effect<T, BobError>`. DRY across all handlers.

4. **tRPC facade is minimal diff** — the router file keeps the same Zod input validation and procedure type. Only the body changes from inline logic to a handler call. This keeps the 370 tests stable.

5. **Effect-RPC handlers built incrementally** — we don't need to wire all 308 at once. The BobRpcGroup in `apps/bob/src/server/rpc.ts` grows as handlers are extracted.

---

## Tasks

### Task 1: Handler context type + wrapHandler bridge

**Files:**
- Create: `packages/bob/src/api/src/handlers/context.ts`
- Create: `packages/bob/src/api/src/handlers/bridge.ts`
- Create: `packages/bob/src/api/src/__tests__/handler-bridge.test.ts`

**Step 1: Create context.ts**

```ts
// packages/bob/src/api/src/handlers/context.ts
export interface HandlerContext {
  readonly db: any;
  readonly userId: string;
}
```

Minimal context shared by all handler functions. `db` is `any` to avoid coupling to a specific Drizzle generic — Bob's db is `NodePgDatabase<bobSchema>` but handlers only need the query API.

**Step 2: Create bridge.ts**

```ts
// packages/bob/src/api/src/handlers/bridge.ts
import { Effect } from "effect";
import { TRPCError } from "@trpc/server";
import { mapTrpcError } from "@gmacko/bob/contracts";
import type { HandlerContext } from "./context.js";

export function wrapHandler<I, O, E>(
  fn: (ctx: HandlerContext, input: I) => Promise<O>,
  ctx: HandlerContext,
  input: I,
  entityName = "unknown",
): Effect.Effect<O, ReturnType<typeof mapTrpcError>> {
  return Effect.tryPromise({
    try: () => fn(ctx, input),
    catch: (error) => {
      if (error instanceof TRPCError) {
        if (error.code === "NOT_FOUND") {
          return mapTrpcError("NOT_FOUND", { entity: entityName, id: "unknown" });
        }
        return mapTrpcError(error.code, { message: error.message });
      }
      return mapTrpcError("INTERNAL_SERVER_ERROR", { message: String(error) });
    },
  });
}
```

**Step 3: Create test**

Test that `wrapHandler` correctly:
- Resolves successful handler results into Effect.succeed
- Maps TRPCError NOT_FOUND to BobNotFoundError
- Maps TRPCError FORBIDDEN to BobForbiddenError
- Maps unknown errors to BobConflictError

```ts
// packages/bob/src/api/src/__tests__/handler-bridge.test.ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { TRPCError } from "@trpc/server";
import { BobNotFoundError, BobForbiddenError, BobConflictError } from "@gmacko/bob/contracts";
import { wrapHandler } from "../handlers/bridge";

const ctx = { db: {}, userId: "test-user" };

describe("wrapHandler", () => {
  it("resolves successful handlers", async () => {
    const handler = async () => ({ id: "1" });
    const result = await Effect.runPromise(wrapHandler(handler, ctx, {}));
    expect(result).toEqual({ id: "1" });
  });

  it("maps TRPCError NOT_FOUND to BobNotFoundError", async () => {
    const handler = async () => { throw new TRPCError({ code: "NOT_FOUND" }); };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}, "snapshot").pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(BobNotFoundError);
  });

  it("maps TRPCError FORBIDDEN to BobForbiddenError", async () => {
    const handler = async () => { throw new TRPCError({ code: "FORBIDDEN" }); };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}).pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(BobForbiddenError);
  });

  it("maps unknown errors to BobConflictError", async () => {
    const handler = async () => { throw new Error("boom"); };
    const error = await Effect.runPromise(
      wrapHandler(handler, ctx, {}).pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(BobConflictError);
  });
});
```

**Step 4: Run tests, commit**

```bash
git add packages/bob/src/api/src/handlers/ packages/bob/src/api/src/__tests__/handler-bridge.test.ts
git commit -m "feat(bob/api): handler extraction bridge + HandlerContext type (7B-4D Task 1)"
```

---

### Task 2: Extract snapshot handlers

**Files:**
- Create: `packages/bob/src/api/src/handlers/snapshot.ts`
- Create: `packages/bob/src/api/src/__tests__/handlers-snapshot.test.ts`

**Step 1: Extract handler functions from snapshot.ts**

Read `packages/bob/src/api/src/router/snapshot.ts` and extract the 3 handler functions + the shared `loadAccessibleWorkItem` helper into `handlers/snapshot.ts`. Import `HandlerContext` from `./context.js`.

The handler functions should be:
- `snapshotCreate(ctx, input)` — insert + return
- `snapshotList(ctx, input)` — query + return array
- `snapshotGet(ctx, input)` — query + access check + return nullable

Keep the TRPCError throws for now — the bridge maps them.

**Step 2: Test handlers directly**

Test the handler functions against the real PGlite database. Read Bob's existing test patterns (e.g., `packages/bob/src/api/src/__tests__/`) to understand how they set up the db.

If direct DB testing is too complex, write a simpler test that verifies the handler functions exist, accept the right argument shapes, and can be called with the wrapHandler bridge.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(bob/api): extract snapshot handler functions (7B-4D Task 2)"
```

---

### Task 3: Rewrite snapshot router as facade

**Files:**
- Modify: `packages/bob/src/api/src/router/snapshot.ts`

**Step 1: Replace inline logic with handler calls**

Rewrite `snapshot.ts` to import from `../handlers/snapshot` and delegate:

```ts
export const snapshotRouter = {
  create: protectedProcedure
    .input(z.object({...}))
    .mutation(({ ctx, input }) =>
      snapshotCreate({ db: ctx.db, userId: ctx.session.user.id }, input)),
  list: protectedProcedure
    .input(z.object({...}))
    .query(({ ctx, input }) =>
      snapshotList({ db: ctx.db, userId: ctx.session.user.id }, input)),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      snapshotGet({ db: ctx.db, userId: ctx.session.user.id }, input)),
} satisfies TRPCRouterRecord;
```

**Step 2: Run Bob's API test suite**

```bash
cd packages/bob/src/api && npx vitest run --no-file-parallelism
```

Expected: 370 passed, 1 skipped — UNCHANGED. If any snapshot-related test fails, the extraction has a bug.

**Step 3: Commit**

```bash
git commit -m "refactor(bob/api): snapshot router → facade over extracted handlers (7B-4D Task 3)"
```

---

### Task 4: Wire snapshot Effect-RPC handlers

**Files:**
- Create: `packages/bob/src/api/src/rpc-handlers/snapshot.ts`
- Modify: `apps/bob/src/server/rpc.ts`
- Create: `packages/bob/src/api/src/__tests__/rpc-snapshot.test.ts`

**Step 1: Create rpc-handlers/snapshot.ts**

Wire the 3 snapshot handlers through the `wrapHandler` bridge to produce Effect-RPC handler layers.

Note: The RPC handlers need a `HandlerContext` from the request. During 7B-4D-alpha, we'll build this from a hardcoded/injected context rather than from the AuthMiddleware — full middleware integration comes in 7B-4D-beta.

The simplest approach: create a function that accepts a `HandlerContext` and returns the subset handler layer for the 3 snapshot RPCs.

```ts
// packages/bob/src/api/src/rpc-handlers/snapshot.ts
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import { snapshotCreate, snapshotList, snapshotGet } from "../handlers/snapshot.js";

export const makeSnapshotHandlers = (ctx: HandlerContext) => ({
  "planning.snapshot.create": ({ payload }: any) =>
    wrapHandler(snapshotCreate, ctx, payload, "snapshot"),
  "planning.snapshot.list": ({ payload }: any) =>
    wrapHandler(snapshotList, ctx, payload, "snapshot"),
  "planning.snapshot.get": ({ payload }: any) =>
    wrapHandler(snapshotGet, ctx, payload, "snapshot"),
});
```

**Step 2: Test the RPC handler**

Create a test that constructs a `HandlerContext`, calls `makeSnapshotHandlers`, and verifies the returned handlers produce Effects that resolve correctly.

**Step 3: Update apps/bob/src/server/rpc.ts**

This is the proof-of-concept integration point. The full wiring (merging all groups + auth middleware providing HandlerContext) is deferred to 7B-4D-beta. For now, just demonstrate the pattern compiles and the health endpoint still works.

Add a comment noting where snapshot handlers will be merged in:

```ts
// TODO 7B-4D-beta: merge PlanningRpc handlers here
// const snapshotHandlers = makeSnapshotHandlers(ctx);
```

**Step 4: Commit**

```bash
git commit -m "feat(bob/api): snapshot Effect-RPC handler bridge (7B-4D Task 4)"
```

---

### Task 5: Final verification

**Files:**
- None new — just test runs

**Step 1: Run full Bob API test suite**

```bash
cd packages/bob/src/api && npx vitest run --no-file-parallelism
```

Expected: 370 passed, 1 skipped.

**Step 2: Run core test suite**

```bash
pnpm exec turbo run test --filter=@gmacko/core --force -- --no-file-parallelism
```

Expected: 458 passed.

**Step 3: Run Bob contract tests**

```bash
cd packages/bob && npx vitest run src/contracts/ --reporter=verbose
```

Expected: 46 passed.

**Step 4: Commit verification doc (optional) or just report**

---

## Test Baselines

- `@gmacko/core` tests: 458 (unchanged)
- `@bob/api` tests: 370 passed, 1 skipped (CRITICAL — must not change)
- Bob contract tests: 46 passed (unchanged)
- New handler tests: ~6-10 new tests

## Completion Criteria

- [ ] `HandlerContext` type defined
- [ ] `wrapHandler` bridge tested
- [ ] snapshot handlers extracted and tested
- [ ] snapshot tRPC router rewired as facade — 370 tests still pass
- [ ] snapshot Effect-RPC handlers wired through bridge
- [ ] Pattern documented for 7B-4D-beta to follow
