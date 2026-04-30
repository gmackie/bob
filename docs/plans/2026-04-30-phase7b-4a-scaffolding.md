# Phase 7B-4A — Domain Services Scaffolding

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold the infrastructure needed for migrating Bob's 338 tRPC procedures to Effect-RPC: Bob contracts package, Effect-RPC server mount in apps/bob, and handler bridge utilities.

**Architecture:** Three scaffolding layers — (1) a contracts directory in `@gmacko/bob` with `./contracts` subpath export, (2) an `/api/rpc` route in `apps/bob` that mounts an Effect-RPC server alongside the existing tRPC mount, (3) bridge utilities that let Effect-RPC handlers delegate to existing tRPC business logic. The existing `/api/trpc` endpoint stays untouched; both endpoints coexist.

**Tech Stack:** Effect 4.0.0-beta.43 (`effect/unstable/rpc`), Vinext/Next.js route handlers, `@gmacko/core` auth infrastructure (`AuthMiddleware`, `CurrentUser`), Drizzle ORM.

**Branch:** `phase-7b-4-domain-services`  
**Worktree:** `~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services`

---

## Task 1: Bob contracts package structure

Create the contracts directory within `@gmacko/bob` and add a subpath export so consumers can `import { ... } from "@gmacko/bob/contracts"`.

**Files:**
- Create: `packages/bob/src/contracts/index.ts`
- Create: `packages/bob/src/contracts/errors.ts`
- Create: `packages/bob/src/contracts/groups/` (empty directory — files land in Phase C tasks)
- Create: `packages/bob/src/contracts/schemas/` (empty directory — files land in Phase C tasks)
- Modify: `packages/bob/package.json` — add `"./contracts"` export

### Step 1: Write the barrel test

Create a test that verifies the contracts subpath is importable and exports the error types.

Create `packages/bob/src/contracts/__tests__/barrel.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "@gmacko/bob/contracts";

describe("@gmacko/bob/contracts barrel", () => {
  it("exports BobNotFoundError as a tagged error class", () => {
    const err = new BobNotFoundError({ entity: "workItem", id: "abc" });
    expect(err._tag).toBe("BobNotFoundError");
  });

  it("exports BobForbiddenError as a tagged error class", () => {
    const err = new BobForbiddenError({ message: "no access" });
    expect(err._tag).toBe("BobForbiddenError");
  });

  it("exports BobConflictError as a tagged error class", () => {
    const err = new BobConflictError({ message: "duplicate slug" });
    expect(err._tag).toBe("BobConflictError");
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/bob test -- --no-file-parallelism
```

Expected: FAIL — cannot resolve `@gmacko/bob/contracts`.

### Step 3: Create the errors module

Create `packages/bob/src/contracts/errors.ts`:

```ts
import { Schema } from "effect";

export class BobNotFoundError extends Schema.TaggedErrorClass<BobNotFoundError>()(
  "BobNotFoundError",
  { entity: Schema.String, id: Schema.String },
) {}

export class BobForbiddenError extends Schema.TaggedErrorClass<BobForbiddenError>()(
  "BobForbiddenError",
  { message: Schema.String },
) {}

export class BobConflictError extends Schema.TaggedErrorClass<BobConflictError>()(
  "BobConflictError",
  { message: Schema.String },
) {}
```

These parallel `@gmacko/core/rpc/errors` (`NotFoundError`, `UnauthorizedError`) but are Bob-specific domain errors. `BobNotFoundError` takes `entity` + `id` (same shape as core's `NotFoundError`). `BobForbiddenError` covers permission checks beyond auth (e.g. "user doesn't own this work item"). `BobConflictError` covers duplicate-name / duplicate-slug scenarios.

### Step 4: Create the barrel

Create `packages/bob/src/contracts/index.ts`:

```ts
export {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "./errors.js";
```

### Step 5: Create empty group and schema directories

```bash
mkdir -p packages/bob/src/contracts/groups
mkdir -p packages/bob/src/contracts/schemas
```

Add placeholder `.gitkeep` files so the empty dirs are tracked:

```bash
touch packages/bob/src/contracts/groups/.gitkeep
touch packages/bob/src/contracts/schemas/.gitkeep
```

### Step 6: Add subpath export to package.json

In `packages/bob/package.json`, change:

```json
"exports": {
  ".": "./src/index.ts"
}
```

to:

```json
"exports": {
  ".": "./src/index.ts",
  "./contracts": "./src/contracts/index.ts"
}
```

### Step 7: Run test to verify it passes

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/bob test -- --no-file-parallelism
```

Expected: PASS — 3 tests pass.

### Step 8: Verify existing tests still pass

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/core test -- --no-file-parallelism
```

Expected: 347/347 pass.

### Step 9: Commit

```bash
git add packages/bob/src/contracts/ packages/bob/package.json
git commit -m "feat(bob): scaffold contracts package with tagged errors (7B-4A Task 1)"
```

---

## Task 2: Effect-RPC server mount in apps/bob

Set up an `/api/rpc` route handler in `apps/bob` alongside the existing `/api/trpc`. Starts with an empty RPC group — just proves the mount works and returns a valid (empty) response.

**Files:**
- Create: `apps/bob/src/app/api/rpc/[...rpc]/route.ts`
- Create: `apps/bob/src/server/rpc.ts` — RPC server Layer composition
- Create: `apps/bob/src/server/layers.ts` — Bob's Effect Layer stack

### Step 1: Write the smoke test

Create `packages/bob/src/contracts/__tests__/smoke-rpc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { Rpc, RpcGroup, RpcServer, RpcSerialization } from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";
import { Schema } from "effect";

const PingRpc = Rpc.make("ping", {
  payload: Schema.Void,
  success: Schema.Struct({ pong: Schema.Boolean }),
});

const PingGroup = RpcGroup.make(PingRpc);

describe("Effect-RPC smoke", () => {
  it("can build a server layer from an RpcGroup", () => {
    const handlers = PingGroup.toLayer({
      ping: () => Effect.succeed({ pong: true }),
    });

    const serverLayer = RpcServer.layerHttp({
      group: PingGroup,
      path: "/api/rpc",
      protocol: "http",
    }).pipe(
      Layer.provide(handlers),
      Layer.provide(RpcSerialization.layerNdjson),
    );

    expect(serverLayer).toBeDefined();
  });
});
```

### Step 2: Run test to verify it passes

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/bob test -- --no-file-parallelism
```

Expected: PASS — confirms Effect-RPC imports work in Bob's package.

### Step 3: Create Bob's Layer stack

Create `apps/bob/src/server/layers.ts`:

```ts
import { Layer } from "effect";

import { layerGmackoDb } from "@gmacko/core/db";
import { layerBetterAuth } from "@gmacko/core/auth/better-auth";
import { layerSessions } from "@gmacko/core/auth/sessions";
import { layerApiKeys } from "@gmacko/core/auth/api-keys";
import { layerTenancy } from "@gmacko/core/auth/tenancy";
import { layerAuthMiddleware } from "@gmacko/core/auth";

import { db } from "@bob/db/client";
import { authBundle } from "~/auth/server";

const dbLayer = layerGmackoDb(db as never);
const betterAuthLayer = layerBetterAuth(authBundle.authInstance);

const sessionsLayer = Layer.provide(
  layerSessions,
  Layer.mergeAll(dbLayer, betterAuthLayer),
);
const apiKeysLayer = Layer.provide(layerApiKeys, dbLayer);
const tenancyLayer = Layer.provide(layerTenancy, dbLayer);

export const runtimeLayer = Layer.mergeAll(
  dbLayer,
  sessionsLayer,
  apiKeysLayer,
  tenancyLayer,
);

export const authMiddlewareLayer = Layer.provide(
  layerAuthMiddleware,
  Layer.mergeAll(sessionsLayer, apiKeysLayer, tenancyLayer),
);
```

This mirrors `apps/core/src/server/layers.ts` but uses Bob's `db` and `authBundle`.

### Step 4: Create the RPC server module

Create `apps/bob/src/server/rpc.ts`:

```ts
import type { Layer as LayerType } from "effect";
import { Layer } from "effect";
import { RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";
import { Schema, Effect } from "effect";
import { Rpc } from "effect/unstable/rpc";

import { AuthMiddleware } from "@gmacko/core/auth";

import { runtimeLayer, authMiddlewareLayer } from "./layers.js";

const HealthRpc = Rpc.make("health", {
  payload: Schema.Void,
  success: Schema.Struct({ ok: Schema.Boolean }),
});

const BobRpcGroup = RpcGroup.make(HealthRpc).middleware(AuthMiddleware);

const handlers = BobRpcGroup.toLayer({
  health: () => Effect.succeed({ ok: true }),
});

const serverLayer = RpcServer.layerHttp({
  group: BobRpcGroup,
  path: "/api/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(handlers),
  Layer.provide(authMiddlewareLayer),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(runtimeLayer),
) as unknown as LayerType.Layer<never, never, HttpRouter.HttpRouter>;

const { handler } = HttpRouter.toWebHandler(serverLayer);

export { handler as rpcHandler };
```

Starts with a single `health` probe RPC behind `AuthMiddleware`. Groups and handlers expand as contracts land in Phases B/C/D.

### Step 5: Create the route handler

Create `apps/bob/src/app/api/rpc/[...rpc]/route.ts`:

```ts
import type { NextRequest } from "next/server";

import { rpcHandler } from "~/server/rpc";

export async function GET(req: NextRequest): Promise<Response> {
  return rpcHandler(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return rpcHandler(req);
}
```

### Step 6: Verify existing tRPC tests still pass

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @bob/api test -- --no-file-parallelism
```

Expected: 370 passed | 1 skipped (unchanged baseline).

### Step 7: Commit

```bash
git add apps/bob/src/app/api/rpc/ apps/bob/src/server/
git commit -m "feat(bob): mount Effect-RPC at /api/rpc with health probe (7B-4A Task 2)"
```

---

## Task 3: Handler bridge utilities

Create shared bridge utilities that let Effect-RPC handlers delegate to existing tRPC business logic. Three pieces:
1. **Context bridge** — extract `db` and session data from the Effect environment (`CurrentUser`, `GmackoDb`) into the shape Bob's handler functions expect.
2. **Error mapping** — convert `TRPCError` codes into Bob's tagged errors and vice versa.
3. **Auth level helpers** — annotate which auth level a procedure requires (public, protected, apiKey).

**Files:**
- Create: `packages/bob/src/contracts/bridge.ts`
- Create: `packages/bob/src/contracts/__tests__/bridge.test.ts`
- Modify: `packages/bob/src/contracts/index.ts` — re-export bridge utilities

### Step 1: Write the failing tests

Create `packages/bob/src/contracts/__tests__/bridge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import {
  mapTrpcError,
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "@gmacko/bob/contracts";

describe("mapTrpcError", () => {
  it("maps NOT_FOUND to BobNotFoundError", () => {
    const result = mapTrpcError("NOT_FOUND", "workItem", "abc-123");
    expect(result._tag).toBe("BobNotFoundError");
    expect((result as InstanceType<typeof BobNotFoundError>).entity).toBe("workItem");
    expect((result as InstanceType<typeof BobNotFoundError>).id).toBe("abc-123");
  });

  it("maps FORBIDDEN to BobForbiddenError", () => {
    const result = mapTrpcError("FORBIDDEN", "workItem", "abc-123");
    expect(result._tag).toBe("BobForbiddenError");
  });

  it("maps CONFLICT to BobConflictError", () => {
    const result = mapTrpcError("CONFLICT", "workItem", "abc-123");
    expect(result._tag).toBe("BobConflictError");
  });

  it("maps unknown codes to BobNotFoundError as fallback", () => {
    const result = mapTrpcError("INTERNAL_SERVER_ERROR", "workItem", "abc-123");
    expect(result._tag).toBe("BobNotFoundError");
  });
});
```

### Step 2: Run test to verify it fails

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/bob test -- --no-file-parallelism
```

Expected: FAIL — `mapTrpcError` is not exported.

### Step 3: Implement the bridge module

Create `packages/bob/src/contracts/bridge.ts`:

```ts
import {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "./errors.js";

type BobDomainError =
  | InstanceType<typeof BobNotFoundError>
  | InstanceType<typeof BobForbiddenError>
  | InstanceType<typeof BobConflictError>;

export function mapTrpcError(
  code: string,
  entity: string,
  id: string,
): BobDomainError {
  switch (code) {
    case "NOT_FOUND":
      return new BobNotFoundError({ entity, id });
    case "FORBIDDEN":
      return new BobForbiddenError({ message: `${entity} ${id}: forbidden` });
    case "CONFLICT":
      return new BobConflictError({ message: `${entity} ${id}: conflict` });
    default:
      return new BobNotFoundError({ entity, id });
  }
}
```

### Step 4: Update the barrel

In `packages/bob/src/contracts/index.ts`, add:

```ts
export {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "./errors.js";

export { mapTrpcError } from "./bridge.js";
```

### Step 5: Run test to verify it passes

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/bob test -- --no-file-parallelism
```

Expected: PASS — all tests pass (barrel + smoke + bridge).

### Step 6: Verify full baseline

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @gmacko/core test -- --no-file-parallelism
```

Expected: 347/347 pass.

```bash
cd ~/.config/superpowers/worktrees/gmacko/phase-7b-4-domain-services && pnpm --filter @bob/api test -- --no-file-parallelism
```

Expected: 370 passed | 1 skipped.

### Step 7: Commit

```bash
git add packages/bob/src/contracts/
git commit -m "feat(bob): add handler bridge utilities (7B-4A Task 3)"
```

---

## Reference: Existing Patterns

### Contract pattern (from `@gmacko/core/contracts`)

```ts
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const SomeRpc = Rpc.make("namespace.verb", {
  payload: Schema.Struct({ ... }),
  success: SomeSchema,
  error: SomeTaggedError,           // single error
  // error: Schema.Union([A, B]),   // multi-error
  // stream: true,                  // for streaming RPCs
});

export const SomeGroup = RpcGroup.make(SomeRpc, AnotherRpc, ...);
```

### Server mount pattern (from `apps/core/src/app/api/rpc/route.ts`)

```ts
const GmackoServerGroup = AuthRpc.merge(ProjectsRpc, SecretsRpc, AgentRpc)
  .middleware(AuthMiddleware);

const allHandlers = GmackoServerGroup.toLayer({ ...handlerMaps });

const serverLayer = RpcServer.layerHttp({
  group: GmackoServerGroup,
  path: "/api/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(allHandlers),
  Layer.provide(authMiddlewareLayer),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(runtimeLayer),
) as unknown as LayerType.Layer<never, never, HttpRouter.HttpRouter>;

const { handler } = HttpRouter.toWebHandler(serverLayer);
```

### Tagged error pattern

```ts
import { Schema } from "effect";

export class MyError extends Schema.TaggedErrorClass<MyError>()(
  "MyError",
  { field: Schema.String },
) {}
```

### Handler map pattern (from `apps/core/src/server/handlers/`)

```ts
export const myHandlerMap = {
  "namespace.verb": ({ payload }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      // business logic
      return result;
    }),
};
```

### tRPC procedure auth levels (from `packages/bob/src/api/src/trpc.ts`)

| Procedure | Auth requirement |
|-----------|-----------------|
| `publicProcedure` | None — `ctx.session` may be null |
| `protectedProcedure` | Requires `ctx.session.user` |
| `apiKeyReadProcedure` | Requires API key with `read` permission |
| `apiKeyWriteProcedure` | Requires API key with `write` permission |
| `apiKeyDeleteProcedure` | Requires API key with `delete` permission |
| `apiKeyAdminProcedure` | Requires API key with `admin` permission |

### Bob tRPC context shape

```ts
{
  authApi: AuthInstance.api,
  session: { user: { id, name, email, ... }, session: { ... } } | null,
  apiKeyAuth: { permissions: string[], userId: string, tenantId: string } | null,
  db: DrizzleInstance,
}
```

---

## Procedure inventory (actual counts, 338 total)

| Router | Q | M | Total | Target group |
|--------|---|---|-------|--------------|
| session | 6 | 22 | 28 | agent.session.* (core) |
| planning | 12 | 9 | 21 | planning.* (bob) |
| workItems | 11 | 9 | 20 | workItem.* (bob) |
| planSession | 5 | 10 | 15 | planning.session.* (bob) |
| forgegraph | 6 | 8 | 14 | external.forgegraph.* (bob) |
| settings | 6 | 7 | 13 | settings.general.* (core) |
| pullRequest | 5 | 7 | 12 | project.pullRequest.* (core) |
| repository | 5 | 7 | 12 | project.repository.* (core) |
| plan | 3 | 8 | 11 | planning.task.* (bob) |
| filesystem | 4 | 5 | 9 | agent.filesystem.* (core) |
| instance | 4 | 5 | 9 | agent.instance.* (core) |
| publicApi | 3 | 6 | 9 | external.publicApi.* (bob) |
| chat | 4 | 4 | 8 | agent.session.* (core) |
| cookies | 2 | 3 | 5 | settings.cookies.* (core) |
| dispatch | 2 | 6 | 8 | planning.dispatch.* (bob) |
| link | 3 | 5 | 8 | workItem.link.* (bob) |
| secrets | 3 | 5 | 8 | settings.secrets.* (core) |
| settingsEdge | 3 | 5 | 8 | settings.general.* (core) |
| webhook | 3 | 5 | 8 | external.webhook.* (bob) |
| featureBranch | 2 | 5 | 7 | project.featureBranch.* (core) |
| git | 3 | 4 | 7 | project.git.* (core) |
| gitProviders | 3 | 3 | 6 | project.gitProvider.* (core) |
| project | 3 | 3 | 6 | project.* (core) |
| skill | 3 | 3 | 6 | planning.skill.* (bob) |
| event | 4 | 1 | 5 | agent.event.* (core) |
| requirement | 1 | 4 | 5 | workItem.requirement.* (bob) |
| terminal | 1 | 4 | 5 | agent.terminal.* (core) |
| workspace | 1 | 3 | 4 | project.workspace.* (core) |
| post | 2 | 2 | 4 | (merge into planning) |
| agentRun | 3 | 0 | 3 | agent.run.* (core) |
| checkpoint | 1 | 2 | 3 | planning.checkpoint.* (bob) |
| snapshot | 2 | 1 | 3 | planning.snapshot.* (bob) |
| auth | 2 | 0 | 2 | auth.* (core) |
| capture | 1 | 1 | 2 | agent.capture.* (core) |
| system | 2 | 0 | 2 | settings.system.* (core) |
