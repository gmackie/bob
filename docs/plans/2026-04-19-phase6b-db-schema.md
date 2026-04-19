# Phase 6B: @gmacko/db Schema Normalization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Add shared Drizzle schema tables for auth, tenancy, secrets, agent sessions, and runner state to `@gmacko/db`, without disturbing existing OODA-adjacent tables. Generate a migration, apply to fresh PGlite, verify round-trip. Also carry forward two 6A retrospective items: expand the Effect 4 API reference table and fix `PostgresUrl` to accept `postgresql://`.

**Architecture:** Drizzle ORM, postgres dialect, dual-driver runtime (PGlite for dev, postgres-js for prod). Schema organized into per-concern files under `packages/db/src/schema/` with a unified barrel. Branded ID columns reference `@gmacko/validators` so downstream RPC contracts + Effect services share the ID types. No physical DB split; per-product migrations reuse these shared tables.

**Tech Stack:** drizzle-orm 0.44, drizzle-zod 0.7, drizzle-kit 0.31, @electric-sql/pglite 0.2, postgres 3.4, zod 4.

**Source design:** `docs/plans/2026-04-19-gmacko-core-finalization-design.md` §4.3. Master plan: `docs/plans/2026-04-19-phase6-core-finalization.md` §6B scope envelope.

**Working branch:** `phase-6b-db-schema` in worktree at `~/.config/superpowers/worktrees/gmacko/phase-6b-db-schema/`.

---

## Scope & Deferrals

### In scope
- Add 15 shared tables across 4 schema files: `auth`, `secrets`, `sessions`, `runner`
- `schema/index.ts` barrel re-exports all new tables alongside existing thread/branch/message
- New subpath exports in `package.json`: `./schema/auth`, `./schema/secrets`, `./schema/sessions`, `./schema/runner`
- Branded IDs from `@gmacko/validators` wired into Drizzle column types
- drizzle-zod insert/select schemas per table
- Round-trip integration tests per table (insert → query → delete against in-memory PGlite)
- A generated migration applied cleanly to a fresh PGlite
- Expand master plan's Effect 4 API reference with Layer/Stream/RpcClient drift
- Fix `PostgresUrl` in `@gmacko/config` to also accept `postgresql://`

### Explicitly deferred
- Bob-specific tables (`work_items`, `artifacts`, `activities`, `projects`, `forge_revisions`, etc.) — stay in Bob during Bob migration (Phase 7)
- OODA-specific tables (`research_threads`, `vault_taxonomy`, etc.) — stay in OODA during OODA migration (Phase 8)
- Existing `thread`, `branch`, `message` — OODA-adjacent remnants from current gmacko skeleton. Annotate as OODA-adjacent but **do not modify**; they'll move during OODA migration.
- Auth RLS / row-level security policies — those land with `@gmacko/auth` in 6C
- Full better-auth integration — 6C concern; 6B only defines the auth-shaped tables that better-auth will drive

### Exit criteria
- `pnpm --filter @gmacko/db test` passes for all new tables (round-trip insert/query per table)
- `pnpm --filter @gmacko/db db:generate` produces a clean migration
- `pnpm --filter @gmacko/db db:migrate:pglite` applies to a fresh temp PGlite dir with zero errors
- New subpath exports resolve: `import { users } from "@gmacko/db/schema/auth"` typechecks
- `pnpm -r typecheck` passes at repo root
- `pnpm test` passes at repo root — 45 existing tests still green + new 6B tests
- Master plan's API reference table covers Layer/Stream/RpcClient drift
- `@gmacko/config`'s `PostgresUrl` accepts both `postgres://` and `postgresql://`
- Tagged `phase-6b-complete`

---

## Conventions for 6B

### Table shape conventions
- **IDs:** UUIDs for all tables gmacko owns (matches `@gmacko/validators` UUID-branded types). Better-auth tables (`users`, `sessions`, `accounts`, `verifications`) use `text` PKs because better-auth's generator emits text IDs. Document the exception inline.
- **Timestamps:** `createdAt` (default `now()`, not null) and `updatedAt` (default `now()`, not null) on tables that mutate. Append-only tables (e.g. `task_run_events`) have `createdAt` only.
- **Tenancy:** Every user-scoped table has a `tenantId` FK (not null) so tenant isolation is a single `where` clause away. Exceptions documented.
- **Soft delete:** Do not add `deletedAt` columns in 6B. If we need soft-delete, we'll add in a later phase with a clear reason.
- **Foreign keys:** Cascade on delete when parent owns child lifecycle (e.g. `chat_messages` cascades on `chat_conversations` delete). Use `restrict` or no cascade when child is independent.
- **Indexes:** Add indexes on any column likely to be used in `WHERE` (tenantId, userId, threadId, status). Don't index every column.
- **JSON columns:** Use `jsonb` (not `json`) in Postgres for structured data. Type via `.$type<T>()` with a zod schema alongside for runtime validation.

### Drizzle-zod conventions
For each table, export:
- `<TableName>InsertSchema = createInsertSchema(table)` — for RPC input validation
- `<TableName>SelectSchema = createSelectSchema(table)` — for RPC output shaping
- Derive TS types: `export type <Row> = typeof table.$inferSelect;` and `export type <NewRow> = typeof table.$inferInsert;`

### Test conventions
- Each schema file gets a test file at `packages/db/src/schema/__tests__/<name>.test.ts`
- Use PGlite in-memory DB (no on-disk state). Set up via shared helper `createTestDb()` — create if it doesn't exist in `src/__tests__/helpers.ts`.
- Test shape: happy-path insert → query by PK → query by indexed FK → delete → verify absent.
- For tables with tenancy, verify a query filtered by `tenantId` returns only matching rows.

### Commit conventions
- `feat: add @gmacko/db <concern> schema` per table group (one commit per schema file + tests)
- `chore: update drizzle migration for phase 6b tables` for the generated migration
- `docs: …` for API reference + plan-doc updates
- `fix: …` for the `PostgresUrl` and any reviewer-flagged items

---

## Sub-Tasks

Each task is designed for a single subagent run with TDD discipline (test → RED → impl → GREEN → commit).

### Task 1: Expand master plan Effect 4 API reference with Layer/Stream/RpcClient drift

**Files:**
- Modify: `docs/plans/2026-04-19-phase6-core-finalization.md` (Conventions section, Effect 4 API reference table)

**Rationale:** Carried from 6A retrospective. 6E (agent streaming) and 6G (realtime SSE) will hit `Stream.*` drift; app-shell in 6I will hit `RpcClient.*` drift; all service definitions after this phase will hit `Layer.*` drift. Document now to save rediscovery.

**Step 1: Append the drift table**

Find the existing Effect 4 API reference table in the master plan. Append these rows (preserve table formatting; add after the last existing row):

```markdown
| `Layer.effect(tag, effect)` | `Layer.effect(effect)` — tag moved into `ServiceMap.Service` itself; no tag param | `effect/Layer.d.ts:891` |
| `Layer.succeed(tag, value)` | `Layer.succeed(value)` — same; no tag param | `effect/Layer.d.ts:624` |
| `Layer.scoped(tag, scopedEffect)` | `Layer.effectServices(scopedEffect)` (no direct `scoped` export) | `effect/Layer.d.ts:983` |
| `Stream.async(emit => ...)` callback push-style | **REMOVED** — use Queue + `Stream.fromQueue` for push, or pull-based Channel primitives | not in `Stream.d.ts` |
| `Stream.asyncEffect(...)` | **REMOVED** — same; wrap a Queue | not in `Stream.d.ts` |
| `RpcResolver.make(group)` | `RpcClient.make(group)` — no RpcResolver module anymore | `effect/unstable/rpc/RpcClient.d.ts:93` |
| `RpcClient.make(group, protocol)` with Protocol arg | `RpcClient.make(group)` — Protocol is a service; provide via `RpcClient.layerProtocolHttp()` | `effect/unstable/rpc/RpcClient.d.ts:93, 156` |
```

Also add a short paragraph below the table (before "When a task's code snippet doesn't compile"):

> **SSE in Effect 4:** Because `Stream.async` is gone, the idiomatic push-style SSE producer is: create a `Queue.bounded(n)`, offer to it from the producer side, consume via `Stream.fromQueue(queue)`. The stream yields a value per `Queue.offer` and completes when the queue is `.shutdown`'d. This applies to 6E agent-token streams and 6G realtime event fan-out.

**Step 2: Commit**

```
git add docs/plans/2026-04-19-phase6-core-finalization.md
git commit -m "docs: expand effect 4 api reference with layer/stream/rpcclient drift"
```

---

### Task 2: Fix `PostgresUrl` to accept `postgresql://`

**Files:**
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/__tests__/env.test.ts`

**Rationale:** 6A retrospective item. Drizzle and `postgres-js` both accept `postgres://` and `postgresql://`; restricting to only the short form would block valid `DATABASE_URL` values.

**Step 1: Write failing test**

Edit `packages/config/src/__tests__/env.test.ts` — add a new test inside the `PostgresUrl` describe block:

```typescript
it("accepts postgresql:// scheme (long form)", () => {
  const url = "postgresql://user:pass@localhost:5432/db";
  expect(Schema.decodeUnknownSync(PostgresUrl)(url)).toBe(url);
});
```

**Step 2: Run test — expect failure**

Run: `pnpm --filter @gmacko/config test`

Expected: FAIL on the new test (`postgresql://` rejected because current pattern is `startsWith("postgres://")`).

**Step 3: Update `PostgresUrl` schema**

Edit `packages/config/src/env.ts`:

```typescript
export const PostgresUrl = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^postgres(?:ql)?:\/\//)),
);
```

(Replace the existing `startsWith` filter. The regex accepts both `postgres://` and `postgresql://`.)

**Step 4: Run test — expect pass**

Run: `pnpm --filter @gmacko/config test`

Expected: all env tests pass, including the new one. Total tests: 10 (was 9).

**Step 5: Typecheck + commit**

```
pnpm --filter @gmacko/config typecheck
git add packages/config/
git commit -m "fix: @gmacko/config PostgresUrl accepts postgresql:// scheme"
```

---

### Task 3: Audit existing OODA-adjacent schema + add annotation

**Files:**
- Modify: `packages/db/src/schema/index.ts` (add header comment)
- Modify: `packages/db/src/schema/threads.ts`, `branches.ts`, `messages.ts` (add per-file header comments)

**Rationale:** The existing `thread`, `branch`, `message` tables are OODA-adjacent (chat conversation shape for the explorer UI). They are NOT part of the gmacko core session primitive (which uses `chat_conversations` + `chat_messages`). Add inline comments clarifying their status so future readers don't confuse them.

**Step 1: Read existing files**

Run: `cat packages/db/src/schema/threads.ts packages/db/src/schema/branches.ts packages/db/src/schema/messages.ts packages/db/src/schema/index.ts`

**Step 2: Prepend header note to each**

To each of the three tables files, prepend:

```typescript
// NOTE: OODA-adjacent. This table is part of the current gmacko skeleton's
// exploration/chat UI and will move to @ooda/thread-model during OODA migration
// (Phase 8). It is NOT the agent session primitive — that lives in
// chat_conversations + chat_messages (packages/db/src/schema/sessions.ts),
// landed in Phase 6B.
```

To `schema/index.ts`, prepend:

```typescript
// @gmacko/db schema barrel.
//
// Table groups:
// - OODA-adjacent (threads, branches, messages): staying during Phase 6; moves in Phase 8.
// - Auth (users, sessions, accounts, verifications, tenants, tenant_members): Phase 6B.
// - Secrets (session_secrets, session_secret_usages, project_deploy_secret_bindings): Phase 6B.
// - Agent sessions (chat_conversations, chat_messages): Phase 6B. NOT to be confused with threads above.
// - Runner (task_runs, task_run_events, runner_devices, runner_capabilities): Phase 6B.
```

**Step 3: Commit**

```
git add packages/db/src/schema/
git commit -m "docs: annotate ooda-adjacent schema tables for phase 6b clarity"
```

---

### Task 4: Add `@gmacko/validators` dep + test helper

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/src/__tests__/helpers.ts`
- Create: `packages/db/vitest.config.ts`

**Rationale:** Schema files will use branded IDs from `@gmacko/validators`. Tests need a shared PGlite helper.

**Step 1: Add deps to `packages/db/package.json`**

Add under `dependencies`:

```json
"@gmacko/validators": "workspace:*",
"effect": "4.0.0-beta.43"
```

Add under `devDependencies`:

```json
"vitest": "^3.0.0"
```

Add scripts (preserve existing `db:*` scripts):

```json
"test": "vitest run",
"typecheck": "tsc --noEmit"
```

**Step 2: Create test helper**

Create `packages/db/src/__tests__/helpers.ts`:

```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Create an in-memory PGlite + Drizzle client for tests.
// Returns a disposable db + a teardown fn.
export async function createTestDb() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmacko-db-test-"));
  const pglite = new PGlite(tmpDir);
  const db = drizzle(pglite, { schema });

  return {
    db,
    pglite,
    teardown: async () => {
      await pglite.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

// Apply all pending migrations against the test db.
// Currently reads the raw-DDL migrate script output.
export async function applyTestMigrations(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
) {
  // Will be implemented after Task 11 generates the first migration.
  // For per-table tests in Tasks 5-9, DDL is applied via Drizzle's push
  // behavior — the test file uses `drizzle-kit push` equivalent via the
  // raw SQL from the table definitions.
  // Placeholder: a future iteration will read from `packages/db/drizzle/*.sql`
  // and execute them in order.
  throw new Error("applyTestMigrations not yet implemented — see Task 11");
}
```

**Step 3: Create vitest config**

Create `packages/db/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 30_000, // PGlite init can take a few seconds
  },
});
```

**Step 4: Install + typecheck**

```
pnpm install
pnpm --filter @gmacko/db typecheck
```

Expected: success.

**Step 5: Commit**

```
git add packages/db/ pnpm-lock.yaml
git commit -m "chore: add @gmacko/validators dep + test helpers to @gmacko/db"
```

---

### Task 5: Build auth schema (users, sessions, accounts, verifications)

**Files:**
- Create: `packages/db/src/schema/auth.ts`
- Create: `packages/db/src/schema/__tests__/auth.test.ts`

**Rationale:** Better-auth will drive these tables in 6C. The shape here must match better-auth's generator output so the integration is drop-in. Reference: Bob's `packages/db/src/auth-schema.ts` (shape).

**Key decisions:**
- PKs are `text` not `uuid` — better-auth's ID generator emits strings (not UUIDs)
- `email` is unique; case-sensitive for now (better-auth handles normalization)
- `session.userId` cascades on user delete
- No tenantId on these four tables — tenancy is per-request (a single user can belong to multiple tenants via `tenant_members`)

**Step 1: Write failing test**

Create `packages/db/src/schema/__tests__/auth.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { users, sessions, accounts, verifications } from "../auth.js";

describe("@gmacko/db auth schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
    // Apply raw DDL — tests run per-table DDL from ../../client helpers
    // For Phase 6B, tables are created via drizzle-kit push in CI/dev; tests
    // use the SQL in src/migrate.ts or `drizzle.run()`
    await ctx.pglite.exec(DDL);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it("users: insert + query by id + query by email", async () => {
    const user: typeof users.$inferInsert = {
      id: "user_test_1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: false,
    };
    await ctx.db.insert(users).values(user);

    const byId = await ctx.db.query.users.findFirst({
      where: eq(users.id, "user_test_1"),
    });
    expect(byId?.email).toBe("alice@example.com");

    const byEmail = await ctx.db.query.users.findFirst({
      where: eq(users.email, "alice@example.com"),
    });
    expect(byEmail?.id).toBe("user_test_1");
  });

  it("sessions: insert + cascade on user delete", async () => {
    await ctx.db.insert(users).values({
      id: "user_cascade",
      name: "Bob",
      email: "bob@example.com",
      emailVerified: false,
    });
    await ctx.db.insert(sessions).values({
      id: "sess_1",
      userId: "user_cascade",
      token: "tok_1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Delete user — session should cascade
    await ctx.db.delete(users).where(eq(users.id, "user_cascade"));
    const remaining = await ctx.db.query.sessions.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("accounts: insert with oauth provider fields", async () => {
    await ctx.db.insert(users).values({
      id: "user_oauth",
      name: "Carol",
      email: "carol@example.com",
      emailVerified: true,
    });
    await ctx.db.insert(accounts).values({
      id: "acct_1",
      userId: "user_oauth",
      providerId: "github",
      accountId: "gh_12345",
      accessToken: "ghp_xxx",
    });

    const acct = await ctx.db.query.accounts.findFirst({
      where: eq(accounts.id, "acct_1"),
    });
    expect(acct?.providerId).toBe("github");
    expect(acct?.accountId).toBe("gh_12345");
  });

  it("verifications: insert + query by identifier", async () => {
    await ctx.db.insert(verifications).values({
      id: "ver_1",
      identifier: "email:alice@example.com",
      value: "random-code-123",
      expiresAt: new Date(Date.now() + 600_000),
    });
    const v = await ctx.db.query.verifications.findFirst({
      where: eq(verifications.identifier, "email:alice@example.com"),
    });
    expect(v?.value).toBe("random-code-123");
  });
});

// Raw DDL — applied per-test because drizzle-kit push infrastructure comes later
// (Task 11). This block is replaced with applyTestMigrations() after Task 11.
const DDL = `
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  account_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX accounts_user_id_idx ON accounts(user_id);
CREATE INDEX verifications_identifier_idx ON verifications(identifier);
`;
```

**Step 2: Run test — confirm RED**

Run: `pnpm --filter @gmacko/db test`

Expected: FAIL on "Cannot find module '../auth.js'" (auth.ts doesn't exist yet).

**Step 3: Implement `packages/db/src/schema/auth.ts`**

```typescript
import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// Better-auth-shaped auth tables. PK type is `text` (not uuid) to match
// better-auth's ID generator. This schema is driven by better-auth at
// runtime (see @gmacko/auth in Phase 6C).

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("accounts_user_id_idx").on(table.userId),
  }),
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    identifierIdx: index("verifications_identifier_idx").on(table.identifier),
  }),
);

// drizzle-zod schemas for RPC validation
export const usersInsertSchema = createInsertSchema(users);
export const usersSelectSchema = createSelectSchema(users);
export const sessionsInsertSchema = createInsertSchema(sessions);
export const sessionsSelectSchema = createSelectSchema(sessions);
export const accountsInsertSchema = createInsertSchema(accounts);
export const accountsSelectSchema = createSelectSchema(accounts);
export const verificationsInsertSchema = createInsertSchema(verifications);
export const verificationsSelectSchema = createSelectSchema(verifications);

// Row type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
```

**Step 4: Update `packages/db/src/schema/index.ts` barrel**

Add to the existing barrel:

```typescript
export * from "./auth.js";
```

**Step 5: Run test — expect pass**

Run: `pnpm --filter @gmacko/db test`

Expected: PASS (4 tests for auth schema, plus existing 0 — new total 4).

**Step 6: Typecheck**

Run: `pnpm --filter @gmacko/db typecheck`

Expected: success.

**Step 7: Commit**

```
git add packages/db/src/schema/auth.ts packages/db/src/schema/__tests__/auth.test.ts packages/db/src/schema/index.ts
git commit -m "feat: add @gmacko/db auth schema (users, sessions, accounts, verifications)"
```

---

### Task 6: Build tenancy schema (tenants, tenant_members)

**Files:**
- Create: `packages/db/src/schema/tenancy.ts`
- Create: `packages/db/src/schema/__tests__/tenancy.test.ts`
- Modify: `packages/db/src/schema/index.ts`

**Key decisions:**
- `tenants.id` is UUID (not text like users) — tenants are gmacko-owned entities
- `tenant_members` has composite uniqueness on `(tenantId, userId)` — a user can be a member of a tenant only once
- `role` is a pgEnum: `owner | admin | member`
- `tenant_members.userId` is `text` (matches `users.id` which is `text`)

**Step 1: Write failing test** (follow the same structure as Task 5's test)

Create `packages/db/src/schema/__tests__/tenancy.test.ts` with:
- Test: insert tenant + query by slug (unique)
- Test: add a member to a tenant; query members by tenant
- Test: enforce uniqueness — inserting the same `(tenantId, userId)` twice should fail
- Test: cascade — deleting a tenant should remove its members

Include an inline DDL block that also creates the `users` table (members reference it). Keep DDL in-test for Task 6; this moves to a shared `applyTestMigrations` after Task 11.

**Step 2: RED**

**Step 3: Implement `packages/db/src/schema/tenancy.ts`**

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./auth.js";

export const tenantRole = pgEnum("tenant_role", ["owner", "admin", "member"]);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
);

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tenantRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("tenant_members_tenant_id_idx").on(table.tenantId),
    userIdIdx: index("tenant_members_user_id_idx").on(table.userId),
    uniqueMember: unique("tenant_members_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
  }),
);

export const tenantsInsertSchema = createInsertSchema(tenants);
export const tenantsSelectSchema = createSelectSchema(tenants);
export const tenantMembersInsertSchema = createInsertSchema(tenantMembers);
export const tenantMembersSelectSchema = createSelectSchema(tenantMembers);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
```

**Step 4: Update barrel** — add `export * from "./tenancy.js";`

**Step 5: GREEN, typecheck, commit**

```
git commit -m "feat: add @gmacko/db tenancy schema (tenants, tenant_members)"
```

---

### Task 7: Build secrets schema (session_secrets, session_secret_usages, project_deploy_secret_bindings)

**Files:**
- Create: `packages/db/src/schema/secrets.ts`
- Create: `packages/db/src/schema/__tests__/secrets.test.ts`
- Modify: `packages/db/src/schema/index.ts`

**Key decisions:**
- `session_secrets.id` is UUID — gmacko-owned
- `session_secrets.tenantId` FK to tenants with cascade (when a tenant is deleted, their secrets go with them)
- Stored ciphertext is `text` (base64-encoded AES-256-GCM output + IV + tag). Encryption is at the `@gmacko/secrets` layer, not the DB's concern.
- `session_secret_usages` is append-only (no updatedAt); each row is one use event for the audit trail
- `project_deploy_secret_bindings` maps a secret to a deploy environment key (e.g. `PROD_DB_URL` → a specific `session_secrets.id`)
- `policy` is jsonb — structured payload validated at the `@gmacko/secrets` layer with its own zod schema. Don't over-specify here.

Reference Bob: `/Volumes/dev/bob/packages/db/src/schema.ts` — grep for `sessionSecrets` (may be further down in the file than the Explore subagent reached). Match Bob's shape where practical, but simplify if Bob's version has Bob-specific columns (e.g. `workItemId`).

**Step 1–5: TDD cycle as before.** Test insert + query by tenantId + foreign-key behavior. Implement with `jsonb` for `policy`, `text` for ciphertext, cascade on tenant delete.

**Step 6: Commit**

```
git commit -m "feat: add @gmacko/db secrets schema (session_secrets, usages, deploy_bindings)"
```

---

### Task 8: Build sessions schema (chat_conversations, chat_messages)

**Files:**
- Create: `packages/db/src/schema/sessions.ts`
- Create: `packages/db/src/schema/__tests__/sessions.test.ts`
- Modify: `packages/db/src/schema/index.ts`

**Key decisions:**
- These are the **agent session primitive** transcripts (not the OODA-adjacent threads in schema/threads.ts)
- `chat_conversations.id` UUID, `.tenantId` FK, `.userId` FK (text — matches users.id)
- `chat_conversations.status` is a pgEnum: `pending | active | completed | failed | canceled`
- `chat_conversations.adapterId` text — tracks which agent adapter (`claude` | `codex` | etc.) ran this session
- `chat_messages` cascades on conversation delete
- `chat_messages.role` pgEnum: `user | assistant | system | tool`
- `chat_messages.content` is `text` (markdown or plain); structured tool-call metadata goes in `metadata` (jsonb)
- `chat_messages.seq` integer for ordering within a conversation (monotonic per conversation)

**Step 1–5: TDD cycle.** Test conversation + message round-trip, cascade on conversation delete, ordering by seq.

**Step 6: Commit**

```
git commit -m "feat: add @gmacko/db sessions schema (chat_conversations, chat_messages)"
```

---

### Task 9: Build runner schema (task_runs, task_run_events, runner_devices, runner_capabilities)

**Files:**
- Create: `packages/db/src/schema/runner.ts`
- Create: `packages/db/src/schema/__tests__/runner.test.ts`
- Modify: `packages/db/src/schema/index.ts`

**Key decisions:**
- `runner_devices.id` UUID, registered by a runner process on startup
- `runner_devices.tenantId` FK to scope a runner to a tenant (optional? or required?). **Decision: required** — multi-tenant isolation. If we later want cross-tenant runners, add a `public` tenant or a separate pool table.
- `runner_devices.status` pgEnum: `idle | busy | draining | offline`
- `runner_capabilities` — many-to-one with runner_devices. Each row is one capability (e.g. `can_codex`, `has_vault_write`). `(deviceId, capability)` is unique.
- `task_runs.id` UUID, `.tenantId` FK, `.status` pgEnum: `pending | claimed | running | completed | failed | canceled`
- `task_runs.claimedByDeviceId` FK to `runner_devices.id` (nullable — null when pending)
- `task_runs.capabilitiesRequired` text[] — array of capability strings the work handler needs
- `task_runs.input` jsonb — work payload (opaque to the runner protocol; structured by work handler)
- `task_runs.result` jsonb — final result on success
- `task_run_events` append-only. `.runId` FK cascade. `.type` pgEnum: `status_change | stdout | stderr | tool_call | tool_result | error | metric`. `.payload` jsonb.
- `task_run_events.seq` integer, monotonic per run_id, for ordering

**Step 1–5: TDD cycle.** Test runner registration + capability advertisement + task claim + event stream, plus cascade on run delete and device delete.

**Step 6: Commit**

```
git commit -m "feat: add @gmacko/db runner schema (task_runs, events, devices, capabilities)"
```

---

### Task 10: Add package subpath exports

**Files:**
- Modify: `packages/db/package.json`

**Step 1: Add subpath exports**

Update the `exports` field:

```json
"exports": {
  ".": "./src/index.ts",
  "./client": "./src/client.ts",
  "./schema": "./src/schema/index.ts",
  "./schema/auth": "./src/schema/auth.ts",
  "./schema/tenancy": "./src/schema/tenancy.ts",
  "./schema/secrets": "./src/schema/secrets.ts",
  "./schema/sessions": "./src/schema/sessions.ts",
  "./schema/runner": "./src/schema/runner.ts"
}
```

**Step 2: Verify subpath resolution**

Create a scratch file `packages/db/src/__tests__/exports.test.ts` that imports from each subpath:

```typescript
import { describe, it, expect } from "vitest";
import { users } from "@gmacko/db/schema/auth";
import { tenants } from "@gmacko/db/schema/tenancy";
import { sessionSecrets } from "@gmacko/db/schema/secrets";
import { chatConversations } from "@gmacko/db/schema/sessions";
import { taskRuns } from "@gmacko/db/schema/runner";

describe("@gmacko/db subpath exports", () => {
  it("resolves every schema subpath", () => {
    expect(users).toBeDefined();
    expect(tenants).toBeDefined();
    expect(sessionSecrets).toBeDefined();
    expect(chatConversations).toBeDefined();
    expect(taskRuns).toBeDefined();
  });
});
```

**Step 3: Run test + typecheck + commit**

```
pnpm --filter @gmacko/db test
pnpm --filter @gmacko/db typecheck
git add packages/db/
git commit -m "feat: add @gmacko/db schema subpath exports"
```

---

### Task 11: Generate drizzle migration + migrate helper

**Files:**
- Modify: `packages/db/src/migrate.ts` (update to run generated migrations in addition to or instead of raw DDL)
- Create: `packages/db/drizzle/<timestamp>_phase6b_tables.sql` (generated by drizzle-kit)
- Modify: `packages/db/src/__tests__/helpers.ts` (implement `applyTestMigrations`)

**Step 1: Generate migration**

Run:

```
pnpm --filter @gmacko/db db:generate
```

Expected: a new SQL file in `packages/db/drizzle/` containing CREATE TABLE + CREATE INDEX statements for all 15 new tables (plus any updates to existing tables if Drizzle detects differences).

**Step 2: Review the generated SQL**

Read the new migration file. Sanity-check: no unexpected DROP TABLE, no changes to the OODA-adjacent tables (thread, branch, message).

**Step 3: Implement `applyTestMigrations`**

Replace the placeholder in `packages/db/src/__tests__/helpers.ts`:

```typescript
export async function applyTestMigrations(
  pglite: PGlite,
) {
  const migrationsDir = path.resolve(__dirname, "../../drizzle");
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await pglite.exec(sql);
  }
}
```

Update `createTestDb` to optionally apply migrations:

```typescript
export async function createTestDb(opts?: { applyMigrations?: boolean }) {
  // ...existing setup...
  if (opts?.applyMigrations ?? true) {
    await applyTestMigrations(pglite);
  }
  return { db, pglite, teardown };
}
```

**Step 4: Remove per-test DDL blocks from Tasks 5-9 tests**

Update each of the schema test files to drop their inline `DDL` constant and rely on `createTestDb()` applying migrations automatically. Verify tests still pass.

**Step 5: Apply migration against a fresh PGlite (integration smoke test)**

Run:

```
rm -rf /tmp/gmacko-pglite-smoke
PGLITE_DATA_DIR=/tmp/gmacko-pglite-smoke pnpm --filter @gmacko/db db:migrate:pglite
```

Expected: zero errors; the data dir has a Postgres-layout DB with all new tables.

**Step 6: Commit**

```
git add packages/db/drizzle/ packages/db/src/migrate.ts packages/db/src/__tests__/helpers.ts packages/db/src/schema/__tests__/*.test.ts
git commit -m "chore: generate drizzle migration for phase 6b tables + wire test migrations"
```

---

### Task 12: Verify 6B exit criteria

**Step 1: Package inventory unchanged**

```
ls packages/ | sort
```

Expected: same 30 dirs as end of 6A.

**Step 2: Typecheck everything**

```
pnpm -r typecheck
```

Expected: all passing, 0 errors.

**Step 3: Full test suite**

```
pnpm test
```

Expected test counts:
- `@gmacko/ui`: 15 (unchanged)
- `@gmacko/wiki`: 8 (unchanged)
- `@gmacko/rpc`: 1 (unchanged)
- `@gmacko/validators`: 12 (unchanged)
- `@gmacko/config`: 10 (9 from 6A + 1 new PostgresUrl test in Task 2)
- `@gmacko/db`: N new tests — sum of Tasks 5-9 test counts + 1 for exports (Task 10)
- **Total: ~45 + @gmacko/db tests**, 0 failing

**Step 4: Fresh migration smoke**

```
rm -rf /tmp/gmacko-pglite-verify
PGLITE_DATA_DIR=/tmp/gmacko-pglite-verify pnpm --filter @gmacko/db db:migrate:pglite
```

Expected: no errors.

**Step 5: Subpath imports typecheck**

Already covered by Task 10's exports test. Re-run.

**Step 6: Git tree clean**

```
git status
```

Expected: `nothing to commit, working tree clean`

**Step 7: Tag milestone (if all above pass)**

```
git tag phase-6b-complete
```

---

## Phase 6B — Completed ✅

Tagged `phase-6b-complete`. 30 packages (unchanged from 6A). 24 typechecks passing. 71 tests passing (up from 46). Migration `0000_curly_jimmy_woo.sql` applies cleanly to fresh PGlite with 18 tables + 6 new enums + 21 indexes.

## Open items carried into 6C onboarding

From the Phase 6B final code review (three Important follow-ups + several onramp recommendations):

- **`migrate.ts` is not idempotent** (`packages/db/src/migrate.ts`). Current version re-executes every statement on every run — second invocation against a persistent `~/.gmacko/data` will throw "relation already exists". Replace with drizzle's built-in `migrate()` helper (tracks applied migrations via `__drizzle_migrations`) before 6C lands. This will also be needed when 6C adds `0001_auth_policies.sql`.
- **`chat_conversations.adapterId` is `varchar(64)`** (`packages/db/src/schema/sessions.ts:53`). Too tight for future compound adapter IDs like `claude-code:anthropic:workspace-uuid`. Widen to `varchar(128)` in the first 6C migration, before any production data lands.
- **`applyTestMigrations` needs hardening** (`packages/db/src/__tests__/helpers.ts:41-42`). Sort by filename works for `0000_*` convention but breaks at migration #10000 (drizzle-kit pads to 4 digits). Add a guard that throws on empty `drizzle/*.sql` glob so tests don't silently pass against an unmigrated DB.
- **`session_secret_usages.sessionId` should become a real FK** (`packages/db/src/schema/secrets.ts:87`). Currently a bare UUID to avoid cyclic dep with sessions; now that both tables exist, a 6E-scoped migration can promote to `ON DELETE SET NULL` FK.
- **Add a downstream-usage cross-schema test in 6C** that imports from all 5 subpaths and does a JOIN traversal (tenant → members → users → chat_conversations) to prove the graph hangs together before auth tries it at runtime.
- **Perf: composite indexes** on `(tenantId, status)` for `task_runs` and `chat_conversations`, and `(tenantId, userId)` for `chat_conversations`. Defer to a perf pass when real query patterns emerge.

## Convention reinforced

- Each sub-phase: dedicated plan doc → TDD tasks with individual commits → exit-criteria verification → tag. Phase 6B followed this cleanly; keep for 6C.
- Effect 4 API drift findings land in the master plan's reference table as they're discovered. Run a preemptive drift check at the start of each phase for the APIs it will touch.
