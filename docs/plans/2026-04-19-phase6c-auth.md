# Phase 6C: @gmacko/auth — Detailed Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task is a complete RED-GREEN-COMMIT cycle; dispatch a subagent per task via `superpowers:subagent-driven-development`.

**Goal:** Build `@gmacko/auth` — better-auth wrapped as an Effect 4 Service, with tenancy RBAC baked in, a `CurrentUser` populated via Rpc middleware, GitHub OAuth, device flow, and tenant-scoped API keys. Clear the 6B retrospective follow-ups on the way in.

**Source design:** `docs/plans/2026-04-19-gmacko-core-finalization-design.md` §5 (auth decisions).

**Working branch:** `phase-6c-auth` in worktree at `~/.config/superpowers/worktrees/gmacko/phase-6c-auth/`.

**Prior art:** `/Volumes/dev/bob/packages/auth/` (reference implementation — we're Effect-ifying it, not forking verbatim).

---

## Exit criteria

1. `pnpm -r typecheck` green
2. `pnpm test` green — at least 95 tests total (current: 71; 6C adds ≥ 24)
3. Migration `0001_auth_phase6c.sql` applies cleanly to a fresh PGlite *and* on top of `0000_curly_jimmy_woo.sql` (verified by running migrate twice)
4. `@gmacko/auth` exports a stable public API: `BetterAuth`, `Sessions`, `ApiKeys`, `DeviceCodes`, `Tenancy`, `AuthMiddleware`, `initAuth`, `createAuthClient`, `createExpoAuthClient`, `layer` (app-composed Layer)
5. Cross-schema JOIN smoke test passes (users → tenant_members → tenants → chat_conversations)
6. `packages/rpc` `CurrentUser` shape widened to include branded `UserId`/`TenantId` + `role`; `requireAuth` still works against it
7. No regressions: all 6A + 6B tests still green
8. Branch ready to tag `phase-6c-complete`

---

## Design decisions (locked for this phase)

- **Tenant resolution — Option B (pragmatic):**
  1. If request has `X-Tenant-Id` header → `Tenancy.assertMembership(userId, tenantId)` → use it.
  2. Else → `Tenancy.listMemberships(userId)`; if exactly one → auto-select it.
  3. Else → fail with `TenantNotSelectedError` (tagged Rpc error). Client must pick.
- **API keys — tenant-scoped:** `(userId, tenantId)` pair. Revoking a user's tenant membership revokes their keys for that tenant. Prefix: `gmk_` (the default; configurable via `initAuth({ apiKeyPrefixes })` for Bob/OODA reuse).
- **Session auth:** primary = better-auth cookie. Bearer session tokens from `Authorization: Bearer ...` also accepted (for mobile/desktop). API keys use the same header; the prefix disambiguates.
- **Better-auth instance lifecycle:** created once at app boot; held as a `Layer.succeed(BetterAuth)(instance)` singleton. No request-scoped re-init.
- **Device flow:** user-facing `user_code` (8 chars, no ambiguous glyphs), `device_code` UUID. On approval, server mints a tenant-scoped API key, stores it on the `device_codes` row, and the polling device claims + deletes the row.
- **CurrentUser shape breaking change:** `@gmacko/rpc` widens `CurrentUserShape` to include `role: TenantMemberRole`, `userId: UserId`, `tenantId: TenantId`, `email: string`. `requireAuth` stays the same. All downstream handlers continue to compile (there's no downstream yet — rpc package only has itself as consumer in the current tree).
- **Testing DB strategy:** reuse `createTestDb()` + `applyTestMigrations()` from 6B. Auth tests run against in-memory PGlite. Better-auth itself is initialized against the test DB for integration; we don't mock it.

---

## Effect 4 API additions (append to master plan table after 6C lands)

| Effect 3.x / common pattern | Effect 4.0.0-beta.43 | Where verified |
|---|---|---|
| Access `Request` from handler | `yield* HttpServerRequest` — it's a `ServiceMap.Service<HttpServerRequest, HttpServerRequest>` | `effect/unstable/http/HttpServerRequest.d.ts:59` |
| Cookie parsing manual | `req.cookies` is pre-parsed `Record<string, string>` on `HttpServerRequest` | `effect/unstable/http/Cookies.d.ts:23` |
| `Rpc.make({ middleware })` option | `Rpc.middleware(AuthMiddlewareService)` pipe; the middleware is a `RpcMiddleware.ServiceClass` | `effect/unstable/rpc/RpcMiddleware.d.ts:27`, `Rpc.d.ts:69` |
| Ad-hoc Layer wrapping with Request access | `RpcMiddleware.ServiceClass<Self, "id", Provides, Error, ClientError, Requires>()` — pre-handler, can `yield* HttpServerRequest`, produces services into context | `effect/unstable/rpc/RpcMiddleware.d.ts:27-35` |
| `Effect.tryPromise({ try, catch })` | Same — still exists, same signature. Catch receives `unknown`. | `effect/Effect.d.ts:1367` |
| `Layer.effect(tag, eff)` / `Layer.succeed(tag, val)` (3.x) | `Layer.effect(eff)` / `Layer.succeed(val)` — tag is on the `ServiceMap.Service` class itself; no separate tag arg | `effect/Layer.d.ts:624, 891` |

These translations land at the top of task 8 (the first auth-specific task) so the subagent sees them before touching Effect APIs it hasn't seen before.

---

## Task breakdown

Each task: **RED** (failing test) → **GREEN** (implementation) → **COMMIT**. Subagents dispatched one per task via `subagent-driven-development`.

---

### Task 1: Make `@gmacko/db` migrate.ts idempotent

**Why now:** Tasks 4–7 generate migration `0001_auth_phase6c.sql`. We need to verify it applies cleanly both from empty and on top of 0000. The current `migrate.ts` is not idempotent (re-executes every statement on every run → "relation already exists" on second call).

**Files:**
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/__tests__/migrate.test.ts` (new, or extend existing)

**Step 1 (RED):** Add a test that calls the migration runner twice against the same persistent PGlite dir and asserts the second call succeeds (no "already exists" errors).

```ts
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../migrate";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runMigrations", () => {
  it("is idempotent (applies twice without error)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gmacko-db-migrate-"));
    const db1 = new PGlite(dir);
    await runMigrations(db1);
    await db1.close();

    const db2 = new PGlite(dir);
    await expect(runMigrations(db2)).resolves.not.toThrow();
    await db2.close();
  });
});
```

Run: `pnpm --filter @gmacko/db test` — expect failure on second migrate.

**Step 2 (GREEN):** Replace the current `migrate.ts` with a wrapper around drizzle's `migrate()` helper. It tracks applied migrations in `__drizzle_migrations` so subsequent calls are no-ops.

Reference: `node_modules/drizzle-orm/pglite/migrator.d.ts` (PGlite-specific migrator).

```ts
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import type { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "../drizzle");

export async function runMigrations(pglite: PGlite): Promise<void> {
  const db = drizzle(pglite);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
```

Run: `pnpm --filter @gmacko/db test` — expect pass.

**Step 3 (commit):**

```
git add packages/db/src/migrate.ts packages/db/src/__tests__/migrate.test.ts
git commit -m "fix: make @gmacko/db migrate.ts idempotent via drizzle's migrate()"
```

---

### Task 2: Harden `applyTestMigrations` helper

**Why:** Silent pass if glob matches zero files; sort breaks at migration #10000 (drizzle pads to 4 digits).

**Files:**
- Modify: `packages/db/src/__tests__/helpers.ts`
- Modify: `packages/db/src/__tests__/helpers.test.ts` (new)

**Step 1 (RED):** Add a test that asserts `applyTestMigrations` throws when the `drizzle/` glob yields zero files, and a test that filename sort is numeric-safe (mock 3 entries `0009_*`, `0010_*`, `0100_*` and assert correct order).

**Step 2 (GREEN):** In `helpers.ts`:
- After glob: `if (files.length === 0) throw new Error("applyTestMigrations: no migrations found at " + pattern)`
- Sort by a numeric parse of the leading digits, not lexicographic: `.sort((a, b) => parseInt(basename(a).slice(0, 4)) - parseInt(basename(b).slice(0, 4)))`. (Lexicographic on 4-digit zero-padded is already safe up to 9999 — that's 9999 migrations, acceptable for now — but the guard is cheap; put a comment noting the convention.)

**Step 3 (commit):**

```
git commit -m "fix: harden applyTestMigrations (empty-glob guard, numeric-safe sort)"
```

---

### Task 3: Cross-schema JOIN smoke test

**Why:** Prove the 6B schema graph hangs together end-to-end before 6C wires auth into it.

**Files:**
- Create: `packages/db/src/__tests__/cross-schema.test.ts`

**Step 1 (RED) + (GREEN) — single-shot test (no separate red):**

Test walks: create a user → tenant → tenant_member (owner) → chat_conversation bound to both → query back via JOIN through all four tables → assert row count + assert cascade deletion (delete user → conversation stays, membership deleted).

```ts
it.effect("joins users → tenant_members → tenants → chat_conversations", () =>
  Effect.gen(function* () {
    const db = yield* makeTestDb;
    const [u] = yield* insertUser(db, { id: "u1", email: "a@b.c", name: "A" });
    const [t] = yield* insertTenant(db, { name: "T", slug: "t" });
    yield* insertTenantMember(db, { tenantId: t.id, userId: u.id, role: "owner" });
    const [c] = yield* insertChatConversation(db, { tenantId: t.id, userId: u.id, adapterId: "claude-code" });

    const rows = yield* db.select(...).from(chatConversations).innerJoin(tenantMembers, ...).innerJoin(tenants, ...).innerJoin(users, ...);
    expect(rows).toHaveLength(1);
    expect(rows[0].user.id).toBe("u1");
    expect(rows[0].tenant.slug).toBe("t");
    expect(rows[0].role).toBe("owner");
  })
);
```

Run: `pnpm --filter @gmacko/db test`. Pass.

**Step 2 (commit):**

```
git commit -m "test: add cross-schema JOIN smoke for users/tenants/members/conversations"
```

---

### Task 4: Widen `chat_conversations.adapterId` to varchar(128)

**Files:**
- Modify: `packages/db/src/schema/sessions.ts` (change `varchar(64)` → `varchar(128)` on `adapterId`)
- (Migration regenerated in Task 7)

**Step 1 (RED):** Add a test in `sessions.test.ts` that inserts an 80-char adapterId (would fail today). Without the schema change, the Drizzle insert will be rejected by PGlite.

**Step 2 (GREEN):** Change `varchar({ length: 64 })` → `varchar({ length: 128 })` on the adapterId column definition.

**Step 3 (commit):**

```
git commit -m "feat(db): widen chat_conversations.adapterId to varchar(128)"
```

> Migration file for this change is generated later in Task 7 along with the 6C additions; the schema-level change lands here so TS tests reflect the new contract.

---

### Task 5: Add `api_keys` table schema

**Files:**
- Create: `packages/db/src/schema/api-keys.ts`
- Create: `packages/db/src/__tests__/api-keys.test.ts`

**Design:**

```ts
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  keyHash: text("key_hash").notNull().unique(), // sha256 hex of full key
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(), // gmk_ + first 8 hex, for display only
  permissions: jsonb("permissions").$type<ApiKeyPermission[]>().notNull().default(["read"]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("api_keys_tenant_user_idx").on(t.tenantId, t.userId),
  index("api_keys_active_idx").on(t.revokedAt), // partial-ish, hot path filter
]);
```

- `ApiKeyPermission` type = `"read" | "write" | "admin"` — exported; will be referenced by `@gmacko/auth` later.
- `keyHash` is **unique** globally — hash collisions over sha256 are not a concern; uniqueness guarantees an attacker can't register a matching hash under a different key.
- Both FKs cascade so revoking a user or deleting a tenant kills the keys.

**Step 1 (RED):** Test round-trips an `apiKeys.$inferInsert` + `.$inferSelect` shape; tests cascade on user delete; tests unique constraint on `keyHash`.

**Step 2 (GREEN):** Implement the table + drizzle-zod insert/select schemas (mirrors pattern in `packages/db/src/schema/auth.ts`).

**Step 3 (commit):**

```
git commit -m "feat(db): add api_keys schema (tenant-scoped, cascade on tenant/user delete)"
```

---

### Task 6: Add `device_codes` table schema

**Files:**
- Create: `packages/db/src/schema/device-codes.ts`
- Create: `packages/db/src/__tests__/device-codes.test.ts`

**Design:**

```ts
export const deviceFlowStatus = pgEnum("device_flow_status", ["pending", "approved", "denied", "consumed", "expired"]);

export const deviceCodes = pgTable("device_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceCode: uuid("device_code").notNull().unique().defaultRandom(),
  userCode: varchar("user_code", { length: 16 }).notNull().unique(),
  status: deviceFlowStatus("status").notNull().default("pending"),
  // Populated on approval:
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  // Timing:
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- `deviceCode` — server → client opaque id, polled.
- `userCode` — short, human-typed code (e.g. `K7B4-9XZM`) the user enters in their browser.
- `apiKeyId` — set on approval; polling device claims by reading + deleting the row.

**Step 1 (RED):** Round-trip test + FK cascade tests + unique on both codes.

**Step 2 (GREEN):** Implement.

**Step 3 (commit):**

```
git commit -m "feat(db): add device_codes schema for device flow"
```

---

### Task 7: Generate migration `0001_auth_phase6c.sql`

**Files:**
- Generate: `packages/db/drizzle/0001_*.sql` via `pnpm --filter @gmacko/db db:generate`
- (No code to write; just run drizzle-kit and verify.)

**Step 1:** Run `pnpm --filter @gmacko/db db:generate`. Drizzle-kit inspects the new schema files (imported from the barrel in Task 5/6) and diffs vs. `0000_curly_jimmy_woo.sql` + `meta/_journal.json`. Expected output: a new 0001 migration with:

- `ALTER TABLE chat_conversations ALTER COLUMN adapter_id TYPE varchar(128);`
- `CREATE TABLE api_keys (...)` + indexes
- `CREATE TYPE device_flow_status AS ENUM (...)`
- `CREATE TABLE device_codes (...)` + unique constraints

**Step 2:** Smoke test — apply twice against fresh PGlite, on top of 0000 applied twice, and also against an existing PGlite dir that already has 0000:

```bash
pnpm --filter @gmacko/db db:migrate:pglite && pnpm --filter @gmacko/db db:migrate:pglite
```

(Both calls must succeed — Task 1's idempotent migrator makes this work.)

**Step 3:** Commit the generated SQL + updated `meta/_journal.json`:

```
git commit -m "chore(db): generate migration 0001 for auth phase6c tables"
```

---

### Task 8: Scaffold `@gmacko/auth` package

**Files:**
- Modify: `packages/auth/package.json` — add deps
- Create: `packages/auth/tsconfig.json` — (currently stub; already extends base)
- Create: `packages/auth/vitest.config.ts`
- Modify: `packages/auth/src/index.ts` — clear the `export {}`, add real barrel stubs

**Deps to add** (production):
- `better-auth` (pin to `1.4.0-beta.9` — same as Bob; bump if 1.4.0 stable is out by 6C time)
- `@better-auth/expo` (same version)
- `@gmacko/db` (workspace)
- `@gmacko/validators` (workspace)
- `@gmacko/rpc` (workspace)
- `effect` (use catalog)

**Deps to add** (dev):
- `@gmacko/tsconfig` (workspace)
- `vitest` (catalog)
- `@effect/vitest` (catalog)
- `typescript`
- `@types/node`
- `@electric-sql/pglite` (for tests only)

**Package exports:**

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./middleware": "./src/middleware.ts",
    "./client": "./src/client.ts",
    "./schema": "./src/schema.ts"
  }
}
```

**Step 1 (RED):** Add a placeholder test that imports from `@gmacko/auth` and asserts a named export exists (e.g. `export const __phase6c = true`). This exercises the workspace resolution.

**Step 2 (GREEN):** Add deps via `pnpm add` from the auth package dir; create tsconfig + vitest config; add placeholder barrel.

**Step 3 (commit):**

```
git commit -m "chore: scaffold @gmacko/auth package (deps, tsconfig, vitest)"
```

---

### Task 9: Widen `CurrentUser` shape in `@gmacko/rpc`

**Why first:** All auth services populate this; getting it right before implementing them means no rewrite later.

**Files:**
- Modify: `packages/rpc/src/context.ts`
- Modify: `packages/rpc/src/middleware.ts` (if needed — should still compile)
- Modify: `packages/validators/src/ids.ts` (check already has `UserId`, `TenantId` — already done in 6A)
- Create/modify: `packages/rpc/src/__tests__/context.test.ts` — if it exists

**New shape:**

```ts
import type { UserId, TenantId } from "@gmacko/validators/ids";

export type TenantMemberRole = "owner" | "admin" | "member";

export interface CurrentUserShape {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly email: string;
  readonly role: TenantMemberRole;
}

export class CurrentUser extends ServiceMap.Service<CurrentUser, CurrentUserShape>()("@gmacko/rpc/CurrentUser") {}
```

**Step 1 (RED):** Tests asserting `CurrentUser` can be constructed from plausible values; `requireAuth` still passes when given a populated `CurrentUser`.

**Step 2 (GREEN):** Update the shape. `requireAuth`'s `if (!user.userId)` check stays valid (branded type still has a truthy runtime value — but tighten the guard to `if (!user.userId || !user.tenantId)`).

**Step 3 (commit):**

```
git commit -m "feat(rpc): widen CurrentUser shape with role + branded UserId/TenantId"
```

---

### Task 10: `BetterAuth` service + `initAuth` factory

**Files:**
- Create: `packages/auth/src/better-auth.ts`
- Create: `packages/auth/src/__tests__/better-auth.test.ts`

**Surface:**

```ts
import { ServiceMap, Layer, Effect } from "effect";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { expo } from "@better-auth/expo";

export type AuthInstance = ReturnType<typeof betterAuth>;
export class BetterAuth extends ServiceMap.Service<BetterAuth, AuthInstance>()("@gmacko/auth/BetterAuth") {}

export interface InitAuthOptions {
  db: /* drizzle pg db */;
  baseUrl: string;
  productionUrl: string;
  secret: string;
  githubClientId: string;
  githubClientSecret: string;
  trustedOrigins?: readonly string[];
}

export function initAuth(opts: InitAuthOptions): AuthInstance {
  return betterAuth({
    database: drizzleAdapter(opts.db, { provider: "pg" }),
    baseURL: opts.baseUrl,
    secret: opts.secret,
    plugins: [expo()],
    socialProviders: {
      github: {
        clientId: opts.githubClientId,
        clientSecret: opts.githubClientSecret,
        redirectURI: `${opts.productionUrl}/api/auth/callback/github`,
        scope: ["user:email", "read:user"],
      },
    },
    trustedOrigins: Array.from(new Set([
      "expo://", "gmacko://",
      "http://localhost:3000",
      opts.baseUrl, opts.productionUrl,
      ...(opts.trustedOrigins ?? []),
    ].filter(Boolean))),
  });
}

export const layerBetterAuth = (instance: AuthInstance) => Layer.succeed(BetterAuth)(instance);
```

**Step 1 (RED):** Tests:
- `initAuth({ ...fake opts })` returns an object with `.api.getSession` function
- `layerBetterAuth(instance)` yields a Layer whose `BetterAuth` service is the instance passed in (provide layer, yield service, assert equality)

**Step 2 (GREEN):** Implement. For the test, pass a minimal drizzle instance built over a fresh `createTestDb()`.

**Step 3 (commit):**

```
git commit -m "feat(auth): add BetterAuth service + initAuth factory + layerBetterAuth"
```

---

### Task 11: `Sessions` Effect service

**Files:**
- Create: `packages/auth/src/sessions.ts`
- Create: `packages/auth/src/__tests__/sessions.test.ts`

**Surface:**

```ts
export class SessionExpiredError extends Schema.TaggedErrorClass<SessionExpiredError>()("SessionExpiredError", {
  message: Schema.String,
}) {}

export class Sessions extends ServiceMap.Service<Sessions, {
  readonly validateToken: (token: string) => Effect.Effect<{ userId: UserId; email: string }, SessionExpiredError>;
  readonly validateBearer: (headerValue: string | null) => Effect.Effect<{ userId: UserId; email: string } | null, SessionExpiredError>;
}>()("@gmacko/auth/Sessions") {}

export const layerSessions = Layer.effect(Sessions)(Effect.gen(function* () {
  const db = yield* GmackoDb; // service from @gmacko/db
  return {
    validateToken: (token) => /* ... query sessions table, check expiresAt, return user */,
    validateBearer: (header) => /* ... parse Bearer, call validateToken */,
  };
}));
```

**Step 1 (RED):** Tests:
- `validateToken("bad")` fails with `SessionExpiredError`
- `validateToken(<valid>)` returns expected user
- `validateToken(<expired>)` fails with `SessionExpiredError`
- `validateBearer(null)` returns `null` (missing header is not an error)
- `validateBearer("Bearer <valid>")` returns user

**Step 2 (GREEN):** Implement via drizzle queries against `sessions` + `users` tables (both in `@gmacko/db/schema/auth`).

**Step 3 (commit):**

```
git commit -m "feat(auth): add Sessions service (token + bearer validation)"
```

---

### Task 12: `ApiKeys` Effect service (tenant-scoped)

**Files:**
- Create: `packages/auth/src/api-keys.ts`
- Create: `packages/auth/src/__tests__/api-keys.test.ts`

**Surface:**

```ts
export type ApiKeyPermission = "read" | "write" | "admin";

export class InvalidApiKeyError extends Schema.TaggedErrorClass<InvalidApiKeyError>()("InvalidApiKeyError", {
  message: Schema.String,
}) {}

export class ApiKeys extends ServiceMap.Service<ApiKeys, {
  readonly issueKey: (input: {
    userId: UserId;
    tenantId: TenantId;
    name: string;
    permissions?: readonly ApiKeyPermission[];
    ttlMs?: number;
  }) => Effect.Effect<{ id: ApiKeyId; plaintext: string; keyPrefix: string }, never>;
  readonly validateKey: (plaintext: string) => Effect.Effect<{
    keyId: ApiKeyId;
    userId: UserId;
    tenantId: TenantId;
    permissions: readonly ApiKeyPermission[];
  }, InvalidApiKeyError>;
  readonly isApiKey: (value: string | null | undefined) => value is string; // prefix check
  readonly revokeKey: (keyId: ApiKeyId) => Effect.Effect<void, never>;
  readonly listForUser: (userId: UserId, tenantId: TenantId) => Effect.Effect<readonly { id: ApiKeyId; name: string; keyPrefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }[], never>;
}>()("@gmacko/auth/ApiKeys") {}
```

**Design notes:**
- Prefix configurable via options on `layerApiKeys({ prefixes })`; default `["gmk_"]`. Bob can do `["gmk_", "bob_"]` when layering in its app.
- Plaintext key format: `gmk_<32 random hex>` (16 bytes of entropy). sha256 hashed before storage. Plaintext returned **only once** from `issueKey`.
- `validateKey` runs sha256 → lookup in `api_keys` where `key_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
- On successful validate, best-effort update `last_used_at`. Fire-and-forget (don't await) — `Effect.fork`.

**Step 1 (RED):**
- `issueKey` returns plaintext with `gmk_` prefix + hex body; DB has hashed row
- `validateKey(plaintext)` returns the user/tenant/permissions
- `validateKey("not_a_key")` → `InvalidApiKeyError`
- `validateKey(<revoked>)` → `InvalidApiKeyError`
- `validateKey(<expired>)` → `InvalidApiKeyError`
- `revokeKey` flips `revokedAt` + subsequent validate fails
- `listForUser` excludes revoked keys by default
- `isApiKey` rejects unknown prefix

**Step 2 (GREEN):** Implement. Use `node:crypto` `randomBytes(16).toString("hex")` + `createHash("sha256")` for hashing.

**Step 3 (commit):**

```
git commit -m "feat(auth): add tenant-scoped ApiKeys service"
```

---

### Task 13: `DeviceCodes` Effect service

**Files:**
- Create: `packages/auth/src/device-codes.ts`
- Create: `packages/auth/src/__tests__/device-codes.test.ts`

**Surface:**

```ts
export class DeviceCodes extends ServiceMap.Service<DeviceCodes, {
  readonly start: () => Effect.Effect<{ deviceCode: string; userCode: string; expiresInSeconds: number }, never>;
  readonly approve: (input: {
    userCode: string;
    userId: UserId;
    tenantId: TenantId;
  }) => Effect.Effect<{ apiKeyId: ApiKeyId }, InvalidUserCodeError | AlreadyApprovedError>;
  readonly poll: (deviceCode: string) => Effect.Effect<
    | { status: "pending" }
    | { status: "approved"; plaintextApiKey: string }
    | { status: "expired" | "denied" | "consumed" },
    InvalidDeviceCodeError
  >;
}>()("@gmacko/auth/DeviceCodes") {}
```

**Design notes:**
- `userCode` format: two groups of 4 Crockford-base32 chars separated by `-`, e.g. `K7B4-9XZM`. Excludes `0/O`, `1/I/L`, `U`.
- TTL: 10 minutes (stored as `expiresAt`). Expired rows are harmless; a cleanup cron is out of scope for 6C.
- `approve` mints an API key via `ApiKeys.issueKey` (so DeviceCodes has `ApiKeys` as a dependency via `yield* ApiKeys`).
- `poll` on `approved` returns the plaintext API key exactly once — the row is updated to `consumed` and the stored `plaintextApiKey` column is cleared. (Hmm — wait, we don't store the plaintext; we only have `apiKeyId`. Reconciliation: `approve` stores the plaintext in a short-lived in-memory map keyed by `userCode` with 10-min TTL, and `poll` reads from it. Simpler alternative: don't mint the API key until `poll` sees `approved` — i.e. `approve` records the intent to issue, `poll` issues at consume time. That's race-free, needs no in-memory state. Pick that approach.)

**Revised flow:**
1. `start` → insert row with `status: "pending"`, return `deviceCode`/`userCode`.
2. `approve(userCode, userId, tenantId)` → update row to `status: "approved"`, populate `userId`/`tenantId`.
3. `poll(deviceCode)` → read row:
   - `pending` → return `{ status: "pending" }`
   - `approved` → mint ApiKey via `ApiKeys.issueKey` (using row's userId+tenantId), update row to `status: "consumed"` with `apiKeyId = <new>`, return `{ status: "approved", plaintextApiKey }`. Race-safe because `UPDATE ... WHERE status = 'approved' RETURNING` — only one polling wins.
   - `consumed` → return `{ status: "consumed" }`
   - expired / denied → likewise

**Step 1 (RED):** Full flow test + each error path + race test (two concurrent polls after approval — only one gets the plaintext).

**Step 2 (GREEN):** Implement.

**Step 3 (commit):**

```
git commit -m "feat(auth): add DeviceCodes service (GitHub device flow for mobile/desktop)"
```

---

### Task 14: `Tenancy` Effect service + `TenantNotSelectedError`

**Files:**
- Create: `packages/auth/src/tenancy.ts`
- Create: `packages/auth/src/__tests__/tenancy.test.ts`

**Surface:**

```ts
export class TenantNotSelectedError extends Schema.TaggedErrorClass<TenantNotSelectedError>()("TenantNotSelectedError", {
  message: Schema.String,
  memberships: Schema.Array(Schema.Struct({ tenantId: TenantId, role: Schema.String })),
}) {}
export class NotAMemberError extends Schema.TaggedErrorClass<NotAMemberError>()("NotAMemberError", {
  userId: UserId, tenantId: TenantId,
}) {}
export class InsufficientRoleError extends Schema.TaggedErrorClass<InsufficientRoleError>()("InsufficientRoleError", {
  required: Schema.Literals(["owner", "admin", "member"]),
  actual: Schema.Literals(["owner", "admin", "member"]),
}) {}

export class Tenancy extends ServiceMap.Service<Tenancy, {
  readonly listMemberships: (userId: UserId) => Effect.Effect<readonly { tenantId: TenantId; role: TenantMemberRole }[], never>;
  readonly assertMembership: (userId: UserId, tenantId: TenantId) => Effect.Effect<TenantMemberRole, NotAMemberError>;
  readonly assertRole: (userId: UserId, tenantId: TenantId, atLeast: TenantMemberRole) => Effect.Effect<void, NotAMemberError | InsufficientRoleError>;
  readonly resolveForUser: (userId: UserId, hintTenantId: TenantId | null) => Effect.Effect<{ tenantId: TenantId; role: TenantMemberRole }, NotAMemberError | TenantNotSelectedError>;
}>()("@gmacko/auth/Tenancy") {}
```

**Role order:** `member < admin < owner`. `assertRole(..., "admin")` passes if actual is `admin` or `owner`.

**`resolveForUser`** implements Option B:
1. If `hintTenantId` provided → `assertMembership` → return.
2. Else `listMemberships`; if length === 1 → return it.
3. Else → `TenantNotSelectedError` with the list of memberships attached so the client can render a picker.

**Step 1 (RED):** Tests cover all branches + role comparison cases.

**Step 2 (GREEN):** Implement via drizzle queries on `tenant_members`.

**Step 3 (commit):**

```
git commit -m "feat(auth): add Tenancy service (memberships, RBAC, Option-B tenant resolution)"
```

---

### Task 15: `AuthMiddleware` — populates `CurrentUser` before Rpc handlers

**Files:**
- Create: `packages/auth/src/middleware.ts`
- Create: `packages/auth/src/__tests__/middleware.test.ts`

**Surface:**

```ts
import { RpcMiddleware } from "effect/unstable/rpc";
import { HttpServerRequest } from "effect/unstable/http";

export class AuthMiddleware extends RpcMiddleware.ServiceClass<
  AuthMiddleware,
  "@gmacko/auth/AuthMiddleware",
  CurrentUser,           // provides
  UnauthorizedError | TenantNotSelectedError, // errors
  never,                 // client errors (stream middleware — not used here)
  HttpServerRequest | Sessions | ApiKeys | Tenancy  // requires
>() {}

export const layerAuthMiddleware = Layer.effect(AuthMiddleware)(
  Effect.sync(() => ({
    wrap: <A, E, R>(handler: Effect.Effect<A, E, R>) => Effect.gen(function* () {
      const req = yield* HttpServerRequest;
      const auth = yield* Sessions;
      const keys = yield* ApiKeys;
      const tenancy = yield* Tenancy;

      const authHeader = req.headers.get("authorization") ?? null;
      const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const hintTenant = (req.headers.get("x-tenant-id") as TenantId | null) ?? null;

      // Try API key first (cheap prefix check)
      let identity: { userId: UserId; email: string } | null = null;
      if (bearer && keys.isApiKey(bearer)) {
        const k = yield* keys.validateKey(bearer).pipe(Effect.mapError(() =>
          new UnauthorizedError({ message: "Invalid API key" })
        ));
        // API keys already carry tenant binding; skip resolveForUser.
        return yield* Effect.provideService(handler, CurrentUser, {
          userId: k.userId, tenantId: k.tenantId, email: /* look up */, role: /* derive */,
        });
      }

      // Fall back to session cookie / bearer session token
      const cookieToken = req.cookies["session"] ?? null; // better-auth default cookie name — TBD
      const sessionToken = cookieToken ?? bearer;
      const session = yield* auth.validateToken(sessionToken ?? "").pipe(Effect.mapError(() =>
        new UnauthorizedError({ message: "No valid session" })
      ));

      const { tenantId, role } = yield* tenancy.resolveForUser(session.userId, hintTenant);
      return yield* Effect.provideService(handler, CurrentUser, {
        userId: session.userId, tenantId, email: session.email, role,
      });
    }),
  }))
);
```

**Step 1 (RED):** Tests: build a minimal HttpServerRequest mock, attach layer, run a trivial handler that returns `CurrentUser`; assert:
- Missing auth → `UnauthorizedError`
- Valid API key → correct user+tenant+role+email in `CurrentUser`
- Valid session + `X-Tenant-Id` → correct tenant
- Valid session, no hint, 1 membership → auto-resolved tenant
- Valid session, no hint, 0 memberships → `TenantNotSelectedError` (should this be UnauthorizedError? No — keep it distinct; clients render a picker vs. a re-login flow)
- Valid session, no hint, 2 memberships → `TenantNotSelectedError` with list of memberships

**Step 2 (GREEN):** Implement. Note: the `email` field on the `CurrentUser` for API-key auth requires a lookup — extend `ApiKeys.validateKey` to also return the user's email (tiny adjustment; update Task 12's shape before it lands, or add a `users` join in this middleware).

Decision: fold the email into `ApiKeys.validateKey` return, so this middleware doesn't need `users` directly. Adjust Task 12's test + impl.

**Step 3 (commit):**

```
git commit -m "feat(auth): add AuthMiddleware (session/api-key → CurrentUser, Option-B tenant)"
```

---

### Task 16: Client factory re-exports

**Files:**
- Create: `packages/auth/src/client.ts`
- (No test needed — this is a pure re-export; the test from Task 8 covers that the module loads.)

**Surface:**

```ts
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";

export function createGmackoAuthClient(opts?: { baseURL?: string }) {
  return createAuthClient({ baseURL: opts?.baseURL });
}

export function createGmackoExpoAuthClient(opts: {
  baseURL: string;
  scheme: string; // e.g. "gmacko" or product-specific
  storage: any;   // SecureStore from expo-secure-store
  storagePrefix: string;
}) {
  return createAuthClient({
    baseURL: opts.baseURL,
    plugins: [expoClient({ scheme: opts.scheme, storage: opts.storage, storagePrefix: opts.storagePrefix })],
  });
}
```

**Step 1 + 2:** Write, typecheck.

**Step 3 (commit):**

```
git commit -m "feat(auth): re-export client factories for web/react and expo"
```

---

### Task 17: Public API barrel + subpath exports verification

**Files:**
- Modify: `packages/auth/src/index.ts`
- Create: `packages/auth/src/__tests__/exports.test.ts` (just imports from `@gmacko/auth` and each subpath, asserts shape)

```ts
// src/index.ts
export { BetterAuth, initAuth, layerBetterAuth, type AuthInstance, type InitAuthOptions } from "./better-auth.js";
export { Sessions, layerSessions, SessionExpiredError } from "./sessions.js";
export { ApiKeys, layerApiKeys, InvalidApiKeyError, type ApiKeyPermission } from "./api-keys.js";
export { DeviceCodes, layerDeviceCodes, InvalidDeviceCodeError, InvalidUserCodeError, AlreadyApprovedError } from "./device-codes.js";
export { Tenancy, layerTenancy, NotAMemberError, InsufficientRoleError, TenantNotSelectedError, type TenantMemberRole } from "./tenancy.js";
export { AuthMiddleware, layerAuthMiddleware } from "./middleware.js";
export { createGmackoAuthClient, createGmackoExpoAuthClient } from "./client.js";

// Convenience: the full layer stack for an app
export const layer = /* Layer.mergeAll(...) */;
```

**Step 1 (RED):** Test imports from `@gmacko/auth` and from each subpath; asserts every named export is a function/class.

**Step 2 (GREEN):** Finalize barrel; add the `layer` convenience export.

**Step 3 (commit):**

```
git commit -m "feat(auth): finalize @gmacko/auth public API barrel"
```

---

### Task 18: Exit verification + tag

**Step 1:** Package count unchanged (30). `pnpm -r typecheck` green.

**Step 2:** Full test suite: `pnpm test` green. Expected counts:
- Baseline 6B: 71 tests
- Task 1 (migrate idempotent): +1
- Task 2 (helpers hardening): +2
- Task 3 (cross-schema JOIN): +1
- Task 4 (adapterId widen): +1
- Task 5 (api_keys schema): +3
- Task 6 (device_codes schema): +3
- Task 8 (auth package smoke): +1
- Task 9 (CurrentUser widen): +1
- Task 10 (BetterAuth): +2
- Task 11 (Sessions): +5
- Task 12 (ApiKeys): +8
- Task 13 (DeviceCodes): +7
- Task 14 (Tenancy): +8
- Task 15 (AuthMiddleware): +6
- Task 17 (exports): +1

**Expected total: ~121 tests** (up from 71). Exit criterion says ≥ 95; we should comfortably beat it.

**Step 3:** Migration smoke:
```bash
rm -rf /tmp/gmacko-pglite-verify
PGLITE_DATA_DIR=/tmp/gmacko-pglite-verify pnpm --filter @gmacko/db db:migrate:pglite
PGLITE_DATA_DIR=/tmp/gmacko-pglite-verify pnpm --filter @gmacko/db db:migrate:pglite  # idempotent
```
Expected: both calls succeed.

**Step 4:** Git tree clean.

**Step 5:** Tag:
```bash
git tag phase-6c-complete
```

**Step 6:** Update `docs/plans/2026-04-19-phase6-core-finalization.md`:
- Append the Task 14 drift-table rows (HttpServerRequest, RpcMiddleware.ServiceClass)
- Add a "Phase 6C — Completed" section summarizing what landed

**Step 7:** Commit the doc update:
```
git commit -m "docs: phase 6c retrospective + drift table updates"
```

---

## Open items for 6D onboarding

Items deliberately deferred from 6C:

- **`session_secret_usages.sessionId` FK promotion** — still a bare UUID; promote to `ON DELETE SET NULL` referencing `chat_conversations.id` in 6E (agent session primitive) when the secret-session linkage is actually exercised.
- **API-key rotation scheduled jobs** — none yet. Manual revoke via `ApiKeys.revokeKey` only.
- **Device-code cleanup cron** — expired rows accumulate. Defer to 6J (reference apps wiring).
- **Composite indexes** on `chat_conversations (tenantId, status)` etc. — still deferred until perf data arrives.
- **Better-auth generated schema** — Bob runs `@better-auth/cli generate`. We're not running it here; 6C's hand-written schema matches better-auth's expected shape. Revisit if better-auth's schema changes.

---

## Convention reinforced

- Each task = RED → GREEN → COMMIT (TDD discipline, verified in 6A/6B).
- Subagent per task via `subagent-driven-development` for isolation.
- Effect 4 drift findings from 6C land in the master plan's reference table during Task 18.
- Every new service ships with `layerX` factory next to it — app composes Layers at the boundary.
