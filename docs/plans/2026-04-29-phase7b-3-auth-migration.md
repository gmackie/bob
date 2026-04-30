# Phase 7B-3 — Bob Auth Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Bob's auth onto gmacko's `@gmacko/auth` Effect services — single shared DB, Bob adopts Effect for auth as beachhead for broader stack migration.

**Architecture:** Bob's server bootstraps a `ManagedRuntime` at startup providing gmacko's `BetterAuth`, `Sessions`, `ApiKeys`, and `Tenancy` layers. Bob's tRPC context resolves sessions/keys by calling `runPromise` into this runtime. Bob's 6 auth schema tables are retired; all auth reads come from gmacko's tables in a shared DB.

**Tech Stack:** Effect 4.0.0-beta.43 (already in Bob), better-auth 1.4.0-beta.9, drizzle-orm, PGlite (dev), PostgreSQL (prod).

**Branch:** `phase-7b-3-auth-migration`
**Base:** `master` (post 7B-2 merge)

---

## Decisions (from brainstorming)

- **Workspace ≈ Tenant**: Same identity layer. Bob keeps workspace/project tables as domain concerns.
- **Single shared DB**: Greenfield — no data migration. Bob's domain tables created alongside gmacko's in one DB.
- **Effect beachhead**: Bob adopts Effect for auth, `ManagedRuntime` bridge to tRPC.
- **Narrow scope**: Auth tables only. DB convergence for domain tables deferred to 7B-4.
- **Shared BetterAuth instance**: Bob imports gmacko's `BetterAuth` Effect service, no duplicate `initAuth()`.

---

## Constraints

- Bob's 370 API tests must stay at 370 passed | 1 skipped throughout.
- `@gmacko/bob` typecheck stays green.
- Smoke tests (apps/core) stay 9/9.
- `@gmacko/core` tests stay 347/347.
- All 11 area packages that import `@bob/auth/schema` (for the `user` table) must keep resolving.

---

## Task 0: Baseline

### Step 1: Capture current state

Run from repo root:

```bash
# Bob API tests
cd packages/bob/src/api && pnpm test --no-file-parallelism
# Expected: 370 passed | 1 skipped

# Typecheck
pnpm exec turbo run typecheck --filter=@gmacko/bob
# Expected: green

# Count @bob/auth consumers
grep -rn 'from "@bob/auth' packages/bob/src apps/bob apps/bob-server --include='*.ts' | grep -v node_modules | grep -v '.d.ts' | wc -l
# Expected: ~17 import sites
```

### Step 2: Document baseline

Save to `docs/plans/phase-7b-3/00-baseline.md`:
- Test counts
- Import site count for `@bob/auth/*`
- List of all files importing from `@bob/auth` (non-schema)

### Step 3: Commit

```bash
git add docs/plans/phase-7b-3/00-baseline.md
git commit -m "docs(phase-7b-3): baseline for auth migration (Task 0)"
```

---

## Task 1: DB Convergence — Point Bob at gmacko's DB

Bob's PGlite client bootstraps a fresh schema from Bob's drizzle definitions.
After this task, Bob's PGlite also bootstraps gmacko's auth tables so both
schema sets coexist in one DB.

### Step 1: Check for table name collisions

```bash
grep -rn 'pgTable("' packages/core/src/db/schema/ packages/bob/src/*/src/schema.ts | \
  sed 's/.*pgTable("\([^"]*\)".*/\1/' | sort | uniq -d
```

If any collisions found, rename Bob's table using drizzle's first argument
(e.g., `pgTable("bob_projects", ...)`). Based on exploration, no collision
exists for `projects` (gmacko core has no `projects` table).

### Step 2: Add gmacko's auth schema to Bob's PGlite bootstrap

**File:** `packages/bob/src/db/src/client-pglite.ts`

Bob's `bootstrapSchema()` function (line 94) uses `drizzle-kit` to diff an
empty snapshot against Bob's schema and generate DDL. After migration, it
also needs gmacko's auth tables (`users`, `sessions`, `accounts`,
`verifications`, `api_keys`, `device_codes`).

Import gmacko's auth schema into Bob's schema barrel so drizzle-kit sees all
tables:

**File:** `packages/bob/src/db/src/schema.ts` (the 15-line barrel)

Add at the top:

```ts
// gmacko auth tables — shared identity layer (Phase 7B-3)
export * from "@gmacko/auth/schema";
```

**File:** `packages/bob/src/db/package.json`

Add dependency:

```json
"@gmacko/auth": "workspace:*"
```

Wait — `@gmacko/auth` doesn't exist as a standalone package. gmacko's auth
lives at `packages/core/src/auth/` and is exported from `@gmacko/core/auth`.
Check:

```bash
grep -n '"exports"' packages/core/package.json
# Find the auth export path
```

**File:** `packages/core/package.json` — verify `./auth` or `./auth/schema`
is exported. If not, add:

```json
"./db/schema/auth": {
  "types": "./dist/db/schema/auth.d.ts",
  "default": "./src/db/schema/auth.ts"
}
```

gmacko's auth tables are defined in:
- `packages/core/src/db/schema/auth.ts` — users, sessions, accounts, verifications
- `packages/core/src/db/schema/api-keys.ts` — api_keys (tenant-scoped)
- `packages/core/src/db/schema/device-codes.ts` — device_codes

The barrel `packages/bob/src/db/src/schema.ts` needs to re-export these.
The exact import path depends on what `@gmacko/core` exports — determine
during implementation.

### Step 3: Verify PGlite bootstraps both schema sets

```bash
cd packages/bob/src/db && pnpm test --no-file-parallelism
# The PGlite client test should create all tables without error
```

### Step 4: Run Bob's API tests

```bash
cd packages/bob/src/api && pnpm test --no-file-parallelism
# Expected: 370 passed | 1 skipped
```

### Step 5: Commit

```bash
git add packages/bob/src/db/ packages/core/package.json
git commit -m "feat(bob): add gmacko auth tables to shared DB schema (Phase 7B-3 Task 1)"
```

---

## Task 2: Create the Effect Auth Runtime Bridge

### Step 1: Add dependencies to `@bob/auth`

**File:** `packages/bob/src/auth/package.json`

Add to dependencies:

```json
"@gmacko/core": "workspace:*",
"effect": "4.0.0-beta.43"
```

(`effect` version must match `packages/bob/package.json` which already has it.)

### Step 2: Write failing test for runtime creation

**File:** `packages/bob/src/auth/src/__tests__/runtime.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createAuthRuntime } from "../runtime";

describe("createAuthRuntime", () => {
  it("creates a runtime that can resolve Sessions", async () => {
    const runtime = createAuthRuntime({
      secret: "test-secret-at-least-32-characters-long!!",
    });
    expect(runtime).toBeDefined();
    // Runtime should be disposable
    await runtime.dispose();
  });
});
```

Run: `cd packages/bob/src/auth && pnpm test -- --no-file-parallelism`
Expected: FAIL — `createAuthRuntime` not found.

### Step 3: Implement the runtime bridge

**File:** `packages/bob/src/auth/src/runtime.ts`

```ts
import { Layer, ManagedRuntime } from "effect";
import {
  BetterAuth,
  type InitAuthOptions,
} from "@gmacko/core/auth";
import { layerSessions } from "@gmacko/core/auth/sessions";
import { layerApiKeys } from "@gmacko/core/auth/api-keys";
import { layerTenancy } from "@gmacko/core/auth/tenancy";

export interface AuthRuntimeOptions {
  secret: string;
  db?: unknown;
  githubClientId?: string;
  githubClientSecret?: string;
}

export function createAuthLayers(options: AuthRuntimeOptions) {
  const betterAuthLayer = BetterAuth.layer({
    secret: options.secret,
    db: options.db,
    // ... other options from InitAuthOptions
  });

  return layerSessions.pipe(
    Layer.provideMerge(layerApiKeys()),
    Layer.provideMerge(layerTenancy),
    Layer.provideMerge(betterAuthLayer),
  );
}

export function createAuthRuntime(options: AuthRuntimeOptions) {
  return ManagedRuntime.make(createAuthLayers(options));
}

export type AuthRuntime = ReturnType<typeof createAuthRuntime>;
```

The exact imports depend on what `@gmacko/core` exports — during
implementation, check:

```bash
grep -n 'layerSessions\|layerApiKeys\|layerTenancy\|BetterAuth' \
  packages/core/src/auth/index.ts
```

### Step 4: Run test

```bash
cd packages/bob/src/auth && pnpm test -- --no-file-parallelism
```

Expected: PASS. The runtime should bootstrap with PGlite since gmacko's
auth layers use the DB from the BetterAuth service.

### Step 5: Write test for session validation through runtime

**File:** `packages/bob/src/auth/src/__tests__/runtime.test.ts` (append)

```ts
it("validates a request with no session as null", async () => {
  const runtime = createAuthRuntime({
    secret: "test-secret-at-least-32-characters-long!!",
  });

  const result = await runtime.runPromise(
    Sessions.validateRequest(new Headers())
  );
  expect(result).toBeNull();
  await runtime.dispose();
});
```

Run test, verify it passes.

### Step 6: Commit

```bash
git add packages/bob/src/auth/
git commit -m "feat(bob): create Effect auth runtime bridge (Phase 7B-3 Task 2)"
```

---

## Task 3: Wire tRPC Context Through Effect Runtime

This is the critical task — replace Bob's `resolveRequestAuthContext()` with
the Effect bridge while keeping the exact same `ctx` shape.

### Step 1: Define the new context type

**File:** `packages/bob/src/auth/src/context.ts`

Keep the `RequestAuthContext` interface (lines 9-32) and
`resolveWorkspaceSelection` helper (lines 37-49) — these are the contract
that tRPC procedures depend on.

Add a new function that resolves auth through the Effect runtime:

```ts
import type { AuthRuntime } from "./runtime";
import { Sessions, ApiKeys } from "@gmacko/core/auth";

export async function resolveAuthContext(
  runtime: AuthRuntime,
  headers: Headers,
  defaultUser?: { ... },
): Promise<RequestAuthContext> {
  // 1. Check API key (Authorization: Bearer gmk_... or bob_...)
  const authHeader = headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isKey = await runtime.runPromise(ApiKeys.isApiKey(token));
    if (isKey) {
      const keyAuth = await runtime.runPromise(ApiKeys.validateKey(token));
      return {
        apiKeyAuth: { keyId: keyAuth.id, permissions: keyAuth.permissions, ... },
        session: null,
        authMethod: "api_key",
        workspace: resolveWorkspaceSelection(headers),
      };
    }
  }

  // 2. Check session (cookie or bearer token)
  const session = await runtime.runPromise(
    Sessions.validateRequest(headers)
  );
  if (session) {
    return {
      session,
      apiKeyAuth: null,
      authMethod: "session",
      workspace: resolveWorkspaceSelection(headers),
    };
  }

  // 3. Default user fallback (dev mode)
  if (defaultUser) {
    return {
      session: { user: defaultUser, session: null },
      apiKeyAuth: null,
      authMethod: "session",
      workspace: resolveWorkspaceSelection(headers),
    };
  }

  // 4. No auth
  return {
    session: null,
    apiKeyAuth: null,
    authMethod: "none",
    workspace: resolveWorkspaceSelection(headers),
  };
}
```

The exact shape of `keyAuth` returned by `ApiKeys.validateKey` must match
what Bob's tRPC procedures expect in `ctx.apiKeyAuth`. Check during
implementation and adapt the mapping.

### Step 2: Update tRPC context creation

**File:** `packages/bob/src/api/src/trpc.ts`

Replace the import and call:

```ts
// Before:
import { resolveRequestAuthContext, ... } from "@bob/auth";

// After:
import { resolveAuthContext, type RequestAuthContext } from "@bob/auth";
import type { AuthRuntime } from "@bob/auth/runtime";
```

Update `createTRPCContext`:

```ts
export const createTRPCContext = async (opts: {
  headers: Headers;
  runtime: AuthRuntime;  // replaces `auth: Auth`
}) => {
  const defaultUser = process.env.REQUIRE_AUTH !== "true" ? { ... } : undefined;
  const authCtx = await resolveAuthContext(opts.runtime, opts.headers, defaultUser);

  return {
    authApi: null,  // retired — was auth.api, no longer needed
    session: authCtx.session,
    apiKeyAuth: authCtx.apiKeyAuth,
    db,
    ...authCtx.workspace,
  };
};
```

### Step 3: Update all callers of `createTRPCContext`

Search for files that pass `auth` to `createTRPCContext`:

```bash
grep -rn 'createTRPCContext' packages/bob/src apps/bob apps/bob-server \
  --include='*.ts' | grep -v node_modules | grep -v '.d.ts'
```

Each caller must now pass `runtime` instead of `auth`. List expected callers:
- `apps/bob/src/trpc/server.ts` or similar
- `apps/bob-server/` tRPC handler
- `apps/bob-ws-gateway/` if it uses tRPC
- Test setup files in `packages/bob/src/api/src/`

For each, replace `auth: authInstance` with `runtime: authRuntime`.

### Step 4: Run tests

```bash
cd packages/bob/src/api && pnpm test --no-file-parallelism
# Expected: 370 passed | 1 skipped
```

If tests fail, check:
- The `ctx` shape matches what procedures read
- The `session` object shape from gmacko's `Sessions.validateRequest` matches
  what Bob's procedures expect (fields: `user.id`, `user.email`, `user.name`, etc.)
- The `apiKeyAuth` shape matches Bob's `ApiKeyAuth` interface

### Step 5: Commit

```bash
git add packages/bob/src/api/ packages/bob/src/auth/
git commit -m "feat(bob): wire tRPC context through Effect auth runtime (Phase 7B-3 Task 3)"
```

---

## Task 4: Retire `@bob/auth` Internals

### Step 1: Delete standalone auth functions

**Files to delete/gut:**
- `packages/bob/src/auth/src/index.ts` — delete `initAuth()`, `Auth` type.
  Replace with re-exports from runtime.
- `packages/bob/src/auth/src/session.ts` — delete `validateSessionToken()`.
  No longer needed; `Sessions.validateRequest` handles this.
- `packages/bob/src/auth/src/api-key.ts` — delete `validateApiKey()`,
  `isApiKey()`, `API_KEY_PREFIXES`. Now handled by `ApiKeys` service.
- `packages/bob/src/auth/src/context.ts` — delete old
  `resolveRequestAuthContext()`. Keep new `resolveAuthContext()` and the
  `RequestAuthContext` type.

### Step 2: Update package.json exports

**File:** `packages/bob/src/auth/package.json`

Remove exports that no longer have backing code:
- `./api-key` — deleted
- `./session` — deleted
- `./middleware` — deleted (if it existed)

Keep:
- `.` — exports `createAuthRuntime`, `resolveAuthContext`, types
- `./client` — browser-side better-auth client (updated in Task 6)
- `./schema` — updated in Step 3
- `./env` — auth env validation (may need updates for shared secret)

### Step 3: Retire auth schema tables

**File:** `packages/bob/src/auth/src/schema.ts`

Delete the 6 table definitions:
- `user`, `session`, `account`, `verification` (better-auth core)
- `apiKeys`, `deviceCodes` (Bob-specific)

Replace with re-export of gmacko's auth user type (needed by the 11 area
packages that `import { user } from "@bob/auth/schema"`):

```ts
// Re-export gmacko's user table so area schemas can reference it for FKs
export { users as user } from "@gmacko/core/db/schema/auth";
```

This aliased re-export (`users as user`) preserves the JS symbol name `user`
that all 11 area packages import for FK references. The underlying table is
gmacko's `users` (plural).

Check that drizzle FK references work with this alias:

```ts
// In @bob/agents/schema.ts:
import { user } from "@bob/auth/schema";
// user.id still works as FK target ✓
```

### Step 4: Update Bob's barrel

**File:** `packages/bob/src/db/src/schema.ts`

The `export * from "@bob/auth/schema"` line now re-exports the aliased
`user` table + gmacko's auth tables (if needed). Verify no duplicate
exports conflict with the gmacko auth schema export added in Task 1.

### Step 5: Run full verification

```bash
# Typecheck
pnpm exec turbo run typecheck --filter=@gmacko/bob

# Tests
cd packages/bob/src/api && pnpm test --no-file-parallelism
# Expected: 370 passed | 1 skipped
```

### Step 6: Commit

```bash
git add packages/bob/src/auth/ packages/bob/src/db/
git commit -m "refactor(bob): retire standalone auth, use @gmacko/auth services (Phase 7B-3 Task 4)"
```

---

## Task 5: Wire Bob's Apps

### Step 1: Update `apps/bob/src/auth/server.ts`

**Current:** Creates standalone `initAuth()` instance.

**After:** Creates the Effect auth runtime:

```ts
import { createAuthRuntime } from "@bob/auth";

export const authRuntime = createAuthRuntime({
  secret: process.env.AUTH_SECRET!,
  githubClientId: process.env.AUTH_GITHUB_ID,
  githubClientSecret: process.env.AUTH_GITHUB_SECRET,
  // db: uses default PGlite or DATABASE_URL from env
});
```

Update the tRPC handler to pass `runtime` instead of `auth`:

```bash
grep -rn 'createTRPCContext\|auth:' apps/bob/src --include='*.ts' | grep -v node_modules
```

### Step 2: Update `apps/bob-server`

Check if bob-server directly creates an auth instance or delegates to blder:

```bash
grep -rn 'initAuth\|@bob/auth' apps/bob-server/src --include='*.ts' | grep -v node_modules
```

If bob-server runs Bob's tRPC routes, wire the runtime the same way. If it
only spawns blder as a child process, no changes needed (blder uses its own
`apps/bob/` auth wiring).

### Step 3: Update `apps/bob-ws-gateway`

Check if the ws-gateway uses auth:

```bash
grep -rn 'initAuth\|@bob/auth\|resolveRequestAuthContext' apps/bob-ws-gateway/src --include='*.ts'
```

Wire the runtime if needed.

### Step 4: Update `apps/bob-execution`

Same check:

```bash
grep -rn '@bob/auth' apps/bob-execution/src --include='*.ts'
```

### Step 5: Verify all apps compile

```bash
pnpm exec turbo run typecheck --filter=@gmacko/bob
```

### Step 6: Commit

```bash
git add apps/bob/ apps/bob-server/ apps/bob-ws-gateway/ apps/bob-execution/
git commit -m "feat(bob): wire all Bob apps to Effect auth runtime (Phase 7B-3 Task 5)"
```

---

## Task 6: Update Auth Client

### Step 1: Update browser-side client

**File:** `packages/bob/src/auth/src/client.ts`

The `createBobAuthClient()` function creates a better-auth client for
React. After migration, it needs to point at the auth routes served by
gmacko's BetterAuth instance (which uses plural table names).

Check if the client config needs changes:

```ts
// Current:
export function createBobAuthClient(baseURL?: string) {
  return createAuthClient({ baseURL });
}
```

The client talks to `/api/auth/*` endpoints which are now served by
gmacko's BetterAuth. If the endpoint paths are the same (better-auth
standard), no client change is needed. Verify:

```bash
grep -rn '/api/auth' apps/bob/src --include='*.ts' | grep -v node_modules
```

If Bob's auth routes are at a different path, update the `baseURL`.

### Step 2: Verify sign-in/sign-out flow still works

This requires a running dev server. Run:

```bash
cd apps/bob && pnpm dev
```

Test in browser: sign-in with GitHub, verify session cookie is set,
verify protected routes work.

### Step 3: Commit

```bash
git add packages/bob/src/auth/src/client.ts
git commit -m "feat(bob): update auth client for shared BetterAuth instance (Phase 7B-3 Task 6)"
```

---

## Task 7: Final Verification + Doc

### Step 1: Run full test sweep

```bash
# Bob API tests
cd packages/bob/src/api && pnpm test --no-file-parallelism
# Expected: 370 passed | 1 skipped

# Typecheck
pnpm exec turbo run typecheck --filter=@gmacko/bob
# Expected: green

# gmacko core tests
pnpm exec turbo run test --filter=@gmacko/core -- --no-file-parallelism
# Expected: 347/347

# Smoke
cd apps/core && pnpm test --no-file-parallelism
# Expected: 9/9
```

### Step 2: Verify auth import sites

```bash
# Old imports should be gone
grep -rn 'from "@bob/auth/session"\|from "@bob/auth/api-key"\|from "@bob/auth/context"' \
  packages/bob/src apps/bob --include='*.ts' | grep -v node_modules
# Expected: 0 results

# Schema imports still work
grep -rn 'from "@bob/auth/schema"' packages/bob/src --include='*.ts' | grep -v node_modules | wc -l
# Expected: 11 (area packages)
```

### Step 3: Write completion doc

Save to `docs/plans/phase-7b-3/01-migration-complete.md`:
- What changed: auth runtime bridge, retired tables, shared DB
- Test results
- Known issues (turbo cycle still present from 7B-2)
- What's next: 7B-4 domain table convergence

### Step 4: Tag and commit

```bash
git add docs/plans/phase-7b-3/
git commit -m "docs(phase-7b-3): auth migration complete (Task 7)"
git tag phase-7b-3-auth-migration-complete
```

---

## Risk / Unknowns

- **gmacko's auth export paths**: The exact import paths for `layerSessions`,
  `layerApiKeys`, `BetterAuth`, etc. depend on what `@gmacko/core` exports.
  May need to add subpath exports to `packages/core/package.json`.
- **Session object shape mismatch**: gmacko's `SessionValidationResult` may
  have different fields than what Bob's tRPC procedures read from `ctx.session`.
  Map carefully in Task 3.
- **PGlite bootstrap with dual schemas**: Bob's `bootstrapSchema()` uses
  drizzle-kit to diff schemas. Adding gmacko's auth tables may produce
  unexpected DDL if there are type conflicts. Test thoroughly in Task 1.
- **CF Workers + Effect**: `ManagedRuntime` should work in Workers but hasn't
  been tested in Bob's Vite + CF stack. May need a lighter bridge for `apps/bob`.
- **better-auth client endpoint routing**: After migration, Bob's frontend
  auth requests need to hit the shared BetterAuth instance's routes. If Bob
  and gmacko run on different origins, CORS / cookie domain config is needed.
