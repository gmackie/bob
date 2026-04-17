# Electron Phase 1 — Node Server + PGlite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove Bob's backend runs end-to-end on Node with a local PGlite database. Running `pnpm --filter @bob/blder start` with `BOB_DB_DRIVER=pglite` on macOS must render the full blder UI and persist data to `~/.bob/userdata/db/`.

**Architecture:** Reuse `apps/blder`'s vinext bundle as the Node server (vinext already exports a prod-server; Cloudflare plugin is opt-in per vite.config.ts). Add a PGlite driver to `packages/db` alongside existing pg / neon drivers. Swap driver at runtime via `BOB_DB_DRIVER` env var. Extraction into a separate `apps/bob-server` + `packages/desktop-server-core` is Phase 2 (not this plan).

**Tech Stack:** pnpm 10.19.0, Node ≥22, TypeScript 5.9, Drizzle ORM 0.44.7, vinext, `@electric-sql/pglite`, `drizzle-orm/pglite`.

**Scope (Phase 1 only):**
- PGlite driver in `packages/db`
- Driver dispatcher in `packages/db/src/client.ts` keyed on `BOB_DB_DRIVER`
- `apps/blder` buildable for Node target (Cloudflare plugin disabled)
- Manual smoke test: full UI end-to-end on Node + PGlite

**Out of scope (later phases):**
- Electron shell (`apps/desktop`)
- `apps/bob-server` extraction
- `packages/desktop-server-core`
- Connection manager UI
- Code signing / DMG / notarization
- Migrating `createTRPCContext` to accept db injection (it currently imports `@bob/db/client` directly — the dispatcher approach works without that refactor)

**Reference design:** `docs/plans/2026-04-16-electron-desktop-design.md`

---

## Prerequisites

Verify before starting:
1. Run `pnpm --version` → `10.19.0`
2. Run `node --version` → `v22.x` or higher
3. Run `pnpm install` from repo root to ensure workspaces are up to date
4. `cd /Volumes/dev/bob` — all paths in this plan are relative to this root

**Relevant existing files to understand before implementing (read these first):**
- `packages/db/src/client.ts` — current pg driver
- `packages/db/src/client-neon.ts` — current neon driver (same shape as client.ts, different import)
- `packages/db/src/migrate.ts` — forward-only migration runner
- `packages/db/drizzle/*.sql` — existing migration files
- `apps/blder/vite.config.ts` — vinext + Cloudflare plugin toggle

---

## Task 1: Add PGlite dependencies

**Files:**
- Modify: `packages/db/package.json`

**Step 1: Add the two new deps**

Edit `packages/db/package.json` to add under `dependencies` (keep alphabetical, use `catalog:` for versions that are catalog-managed if present, otherwise pin):

```json
"@electric-sql/pglite": "^0.3.0",
```

`drizzle-orm` is already present (`^0.44.7`) — PGlite support ships inside drizzle-orm under `drizzle-orm/pglite`, no separate package needed.

**Step 2: Install**

Run: `pnpm install --filter @bob/db`
Expected: resolves without errors; `@electric-sql/pglite` appears in `pnpm-lock.yaml`.

**Step 3: Commit**

```bash
git add packages/db/package.json pnpm-lock.yaml
git commit -m "chore(db): add @electric-sql/pglite dependency"
```

---

## Task 2: Write failing integration test for PGlite driver

**Files:**
- Create: `packages/db/src/client-pglite.test.ts`

**Step 1: Write the failing test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { makePgliteDb, type PgliteDbHandle } from "./client-pglite.js";

describe("client-pglite", () => {
  let handle: PgliteDbHandle;

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("connects in-memory and runs a trivial query", async () => {
    const result = await handle.db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toMatchObject({ one: 1 });
  });

  it("creates a table and round-trips a row", async () => {
    await handle.db.execute(sql`create table t (id serial primary key, name text)`);
    await handle.db.execute(sql`insert into t (name) values ('hello')`);
    const result = await handle.db.execute(sql`select name from t`);
    expect(result.rows[0]).toMatchObject({ name: "hello" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/db test -- client-pglite`
Expected: FAIL — "Cannot find module './client-pglite.js'" or similar.

---

## Task 3: Implement PGlite driver

**Files:**
- Create: `packages/db/src/client-pglite.ts`

**Step 1: Write the driver**

```typescript
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

export type PgliteDbOptions = {
  /** `:memory:` for tests, or an absolute directory path for persistence. */
  dataDir?: string;
};

export type PgliteDbHandle = {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
};

const DEFAULT_DIR = path.join(os.homedir(), ".bob", "userdata", "db");

export async function makePgliteDb(options: PgliteDbOptions = {}): Promise<PgliteDbHandle> {
  const dataDir = options.dataDir ?? DEFAULT_DIR;

  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir === ":memory:" ? undefined : dataDir);
  await client.waitReady;

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}
```

**Step 2: Run test to verify it passes**

Run: `pnpm --filter @bob/db test -- client-pglite`
Expected: PASS — both tests green.

**Step 3: Commit**

```bash
git add packages/db/src/client-pglite.ts packages/db/src/client-pglite.test.ts
git commit -m "feat(db): add PGlite driver for local-first Electron mode"
```

---

## Task 4: Expose PGlite driver via subpath export

**Files:**
- Modify: `packages/db/package.json`

**Step 1: Add export**

Add to the `exports` map in `packages/db/package.json`:

```json
"./client-pglite": {
  "types": "./dist/client-pglite.d.ts",
  "default": "./src/client-pglite.ts"
}
```

(Place it next to `./client-neon` for consistency.)

**Step 2: Verify the new export is importable**

Create a one-off script to verify (delete after):

```typescript
// packages/db/scripts/verify-pglite-export.mjs
import { makePgliteDb } from "@bob/db/client-pglite";
const h = await makePgliteDb({ dataDir: ":memory:" });
console.log("pglite export works");
await h.close();
```

Run: `pnpm --filter @bob/db exec node scripts/verify-pglite-export.mjs`
Expected: prints "pglite export works", exit 0.

**Step 3: Delete the verification script**

```bash
rm packages/db/scripts/verify-pglite-export.mjs
```

**Step 4: Commit**

```bash
git add packages/db/package.json
git commit -m "feat(db): export PGlite driver as @bob/db/client-pglite"
```

---

## Task 5: Write failing test for migration runner against PGlite

**Files:**
- Create: `packages/db/src/migrate-pglite.test.ts`

**Step 1: Write the failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { makePgliteDb, type PgliteDbHandle } from "./client-pglite.js";
import { applyMigrations } from "./migrate.js";

describe("applyMigrations against PGlite", () => {
  let handle: PgliteDbHandle;

  beforeEach(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("applies all forward migrations and records them in bob_migrations", async () => {
    await applyMigrations({ client: handle.client });

    const applied = await handle.db.execute(
      sql`select name from bob_migrations order by applied_at`,
    );
    expect(applied.rows.length).toBeGreaterThan(0);
    // Sanity: the first committed migration name
    expect(applied.rows[0]).toMatchObject({ name: expect.stringContaining("0001") });
  });

  it("is idempotent when run twice", async () => {
    await applyMigrations({ client: handle.client });
    const firstCount = (await handle.db.execute(sql`select count(*)::int as c from bob_migrations`)).rows[0] as { c: number };

    await applyMigrations({ client: handle.client });
    const secondCount = (await handle.db.execute(sql`select count(*)::int as c from bob_migrations`)).rows[0] as { c: number };

    expect(secondCount.c).toEqual(firstCount.c);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/db test -- migrate-pglite`
Expected: FAIL — `applyMigrations` either does not exist as a named export or does not accept `{ client }` (PGlite instance).

---

## Task 6: Refactor migration runner to support both pg and PGlite clients

**Files:**
- Modify: `packages/db/src/migrate.ts`

**Context:** The existing runner connects to Postgres via pg. We need to export an `applyMigrations` function that can accept either a pg `Client` or a PGlite instance, since both support `.query(sql)`.

**Step 1: Read the current runner**

Read `packages/db/src/migrate.ts` fully. Identify the function that loops over SQL files in `packages/db/drizzle/`, reads them, runs them against a client, and records applied names in `bob_migrations`.

**Step 2: Extract the core loop into `applyMigrations({ client })`**

The `client` param must satisfy a minimal shape:

```typescript
export type MigrationClient = {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
};
```

Both `pg.Client` and `PGlite` satisfy this. The runner's CLI wrapper (the existing behavior triggered by `pnpm -F @bob/db migrate`) should stay — it just becomes a thin wrapper that constructs a pg client and calls `applyMigrations`.

Exact refactor sketch (adapt to the actual current code):

```typescript
export type MigrationClient = {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
};

export async function applyMigrations({ client }: { client: MigrationClient }): Promise<void> {
  await client.query(`
    create table if not exists bob_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query(`select name from bob_migrations`)).rows.map(
      (r: any) => r.name as string,
    ),
  );

  const migrationsDir = path.join(__dirname, "..", "drizzle");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query(sqlText);
    await client.query(
      `insert into bob_migrations (name) values ('${file.replace(/'/g, "''")}')`,
    );
  }
}
```

**Important:** Keep whatever flags the existing CLI runner supports (`--bootstrap`, `--dry-run`) working. Only extract the inner loop — don't rewrite the CLI entry.

**Step 3: Run migration test to verify it passes**

Run: `pnpm --filter @bob/db test -- migrate-pglite`
Expected: PASS — both idempotency and forward migration tests green.

**Step 4: Verify CLI runner still works (sanity check)**

If you have a local Postgres running with `DATABASE_URL` set, run the existing CLI:
`pnpm --filter @bob/db migrate --dry-run`
Expected: prints pending migrations without applying, no errors.

If no Postgres is available locally, skip this verification but note it in the commit message.

**Step 5: Commit**

```bash
git add packages/db/src/migrate.ts packages/db/src/migrate-pglite.test.ts
git commit -m "refactor(db): extract applyMigrations for cross-driver use"
```

---

## Task 7: Auto-migrate on PGlite driver init

**Files:**
- Modify: `packages/db/src/client-pglite.ts`

**Step 1: Update makePgliteDb to apply migrations on init**

Add to `client-pglite.ts`:

```typescript
import { applyMigrations } from "./migrate.js";

// inside makePgliteDb, after `await client.waitReady;`:
await applyMigrations({ client });
```

**Step 2: Add a test that confirms auto-migration**

Append to `packages/db/src/client-pglite.test.ts`:

```typescript
it("auto-applies migrations on init", async () => {
  const h = await makePgliteDb({ dataDir: ":memory:" });
  try {
    const result = await h.db.execute(sql`select name from bob_migrations limit 1`);
    expect(result.rows.length).toBe(1);
  } finally {
    await h.close();
  }
});
```

**Step 3: Run tests to verify pass**

Run: `pnpm --filter @bob/db test -- client-pglite`
Expected: all three tests (connect, round-trip, auto-migrate) PASS.

**Step 4: Commit**

```bash
git add packages/db/src/client-pglite.ts packages/db/src/client-pglite.test.ts
git commit -m "feat(db): auto-apply migrations on PGlite init"
```

---

## Task 8: Write failing test for driver dispatcher

**Files:**
- Create: `packages/db/src/client-dispatcher.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";

describe("db client dispatcher (BOB_DB_DRIVER)", () => {
  it("defaults to pg when BOB_DB_DRIVER is unset", async () => {
    delete process.env.BOB_DB_DRIVER;
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/does_not_matter";
    const mod = await import("./client.js?dispatcher-default");
    // The pg driver constructs on import but does not connect until a query runs.
    // We just assert the module loads and exposes `db`.
    expect(mod.db).toBeDefined();
  });

  it("routes to PGlite when BOB_DB_DRIVER=pglite", async () => {
    process.env.BOB_DB_DRIVER = "pglite";
    process.env.BOB_DB_PGLITE_DIR = ":memory:";
    const mod = await import("./client.js?dispatcher-pglite");
    expect(mod.db).toBeDefined();
    // Quick sanity query to confirm it's a live PGlite instance
    const { sql } = await import("drizzle-orm");
    const result = await mod.db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toMatchObject({ one: 1 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @bob/db test -- client-dispatcher`
Expected: FAIL — current `client.ts` always uses pg; PGlite case doesn't work.

---

## Task 9: Implement BOB_DB_DRIVER dispatcher in client.ts

**Files:**
- Modify: `packages/db/src/client.ts`

**Context:** `packages/api/src/trpc.ts` imports `db` from `@bob/db/client`. We preserve that API — `db` stays the default export — but the driver is now selected at module-load time via `BOB_DB_DRIVER`. Default is `pg` (current behavior). New value is `pglite`.

**Step 1: Read the current client.ts**

Take note of everything it exports (not just `db` — there may be types or helpers).

**Step 2: Refactor**

```typescript
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema.js";

type BobDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

function initDb(): BobDb {
  const driver = process.env.BOB_DB_DRIVER ?? "pg";

  if (driver === "pglite") {
    // Synchronous-import PGlite driver. We can't top-level-await here because
    // callers (including tRPC context) expect `db` to be a plain export.
    // The PGlite instance is lazy-initialized on first query via a proxy.
    const { makePgliteDbSync } = require("./client-pglite.js");
    return makePgliteDbSync({
      dataDir: process.env.BOB_DB_PGLITE_DIR,
    });
  }

  if (driver === "pg") {
    const { Pool } = require("pg");
    const { drizzle } = require("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return drizzle(pool, { schema });
  }

  throw new Error(`Unknown BOB_DB_DRIVER: ${driver}`);
}

export const db = initDb();
export { schema };
```

**Important caveat:** The dispatcher must not cause a top-level `await`. PGlite's `waitReady` is async. To keep the `db` export synchronous (required by existing imports in `packages/api`), we need a PGlite helper `makePgliteDbSync` that returns a drizzle instance backed by a PGlite client whose queries await `waitReady` on first use.

**Step 3: Add `makePgliteDbSync` to client-pglite.ts**

Add to `packages/db/src/client-pglite.ts`:

```typescript
export function makePgliteDbSync(options: PgliteDbOptions = {}): PgliteDatabase<typeof schema> {
  const dataDir = options.dataDir ?? DEFAULT_DIR;

  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir === ":memory:" ? undefined : dataDir);

  // drizzle-orm/pglite accepts a PGlite instance; queries internally await waitReady.
  const db = drizzle(client, { schema });

  // Fire-and-forget bootstrap + migration on first tick. Callers that need
  // guaranteed ready-before-query should use `makePgliteDb` instead.
  //
  // IMPORTANT — bootstrap MUST run before applyMigrations, because the
  // drizzle/*.sql files assume a pre-existing ngi-kanbanger/better-auth
  // baseline and can't bootstrap an empty DB. `bootstrapSchema` both creates
  // the target schema from `schema.ts` AND pre-marks every drizzle/*.sql as
  // already-applied, so `applyMigrations` becomes a no-op on a fresh DB.
  void (async () => {
    await client.waitReady;
    await bootstrapSchema(client);
    await applyMigrations({ client, log: () => {} });
  })();

  return db;
}
```

**Caveat to verify during execution:** If `drizzle-orm/pglite` errors on queries before `waitReady` resolves OR before the async bootstrap finishes, this approach needs revision — e.g., wrapping the client in a proxy that awaits a shared ready promise before delegating `query`/`exec`. There IS a real race here: drizzle consumers may fire queries before bootstrap completes, hitting an empty DB. Verify in Task 10 smoke test; if it fails, add the proxy wrapper.

**Step 4: Run dispatcher test**

Run: `pnpm --filter @bob/db test -- client-dispatcher`
Expected: both tests PASS.

**Step 5: Run full packages/db test suite**

Run: `pnpm --filter @bob/db test`
Expected: all tests PASS (no regressions in existing pg-based tests).

**Step 6: Commit**

```bash
git add packages/db/src/client.ts packages/db/src/client-pglite.ts
git commit -m "feat(db): BOB_DB_DRIVER dispatcher for pg vs pglite"
```

---

## Task 10: Verify existing consumers still compile

**Files:** (no changes — this is a verification task)

**Step 1: Run typecheck across the repo**

Run: `pnpm turbo typecheck`
Expected: all packages typecheck with no errors. Any new errors likely mean `BobDb` union type is not assignable where pg-specific types were expected — fix by widening the consumer's type or by adding a narrowing helper in `@bob/db/client`.

**Step 2: Spot-check packages/api builds**

Run: `pnpm --filter @bob/api build`
Expected: clean build.

**Step 3: Commit (if any incidental fixes were needed)**

```bash
git commit -am "chore: typecheck fixes after db dispatcher refactor" # if applicable
```

---

## Task 11: Add BOB_BUILD_TARGET=node to blder vite.config

**Files:**
- Modify: `apps/blder/vite.config.ts`

**Context:** Currently the Cloudflare plugin is enabled whenever `NODE_ENV === "production"` and `CF_PAGES` is unset. For Node-target builds we want the plugin OFF. Also the `node:fs` / `node:os` / `pg-native` stubs exist for the Workers runtime — they must be removed (or swapped for real `node:fs` / `node:os`) when building for Node.

**Step 1: Edit vite.config.ts**

Replace the existing `isDev` gate and resolve aliases with a target-aware block:

```typescript
import path from "node:path";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const target = (process.env.BOB_BUILD_TARGET ?? "cloudflare") as "cloudflare" | "node";
const isDev = process.env.NODE_ENV !== "production" && !process.env.CF_PAGES;
const useCloudflarePlugin = !isDev && target === "cloudflare";

const nodeAliases: Record<string, string> = {
  "~": path.resolve(__dirname, "src"),
};

const cloudflareAliases: Record<string, string> = {
  ...nodeAliases,
  "@bob/db/client": path.resolve(__dirname, "src/lib/db-client-lazy.ts"),
  "node:fs": path.resolve(__dirname, "src/lib/fs-stub.ts"),
  "node:os": path.resolve(__dirname, "src/lib/os-stub.ts"),
  "pg-native": path.resolve(__dirname, "src/lib/pg-native-stub.ts"),
};

export default defineConfig({
  plugins: [
    vinext(),
    ...(useCloudflarePlugin
      ? [
          cloudflare({
            viteEnvironment: {
              name: "rsc",
              childEnvironments: ["ssr"],
            }),
          }),
        ]
      : []),
  ],
  resolve: {
    alias: target === "node" ? nodeAliases : cloudflareAliases,
  },
  ssr: {
    noExternal: [/^@bob\//, "postgres", "drizzle-orm"],
    external: ["pg", "pg-native", "pg-pool", "@electric-sql/pglite"],
  },
});
```

**Step 2: Typecheck the config**

Run: `pnpm --filter @bob/blder exec tsc --noEmit -p tsconfig.json` (or whatever the blder typecheck script is — check `apps/blder/package.json`).
Expected: clean.

**Step 3: Commit**

```bash
git add apps/blder/vite.config.ts
git commit -m "feat(blder): BOB_BUILD_TARGET toggle for Node vs Cloudflare"
```

---

## Task 12: Build blder for Node target

**Files:** (no edits — verification task)

**Step 1: Run the Node-target build**

Run: `BOB_BUILD_TARGET=node pnpm --filter @bob/blder build`
Expected: build completes; `apps/blder/dist/client` and `apps/blder/dist/server` populated. Build should NOT invoke the Cloudflare plugin (no wrangler output, no `_worker.js`).

**Step 2: Inspect output**

```bash
ls apps/blder/dist/server
```

Expected: `entry.js`, `index.js`, `ssr/` directory, `vinext-externals.json` present — same shape as Cloudflare build, but without Worker-specific artifacts.

**Step 3: If build fails**

The most likely failures:
- Missing node stubs: some downstream code still imports `node:fs` expecting a stub. Fix by NOT stubbing in node target (real `node:fs` works).
- `@bob/db/client` behaves differently: make sure `db-client-lazy.ts` is NOT aliased in node target so `@bob/db/client` resolves to the real package export.
- `@electric-sql/pglite` pulled into client bundle: add it to `ssr.external` (done in Task 11) and verify it's not imported from any client-side code.

**Step 4: No commit needed** (verification only).

---

## Task 13: Manual smoke test — boot blder on Node with PGlite

**Files:** (no edits — integration test)

**Step 1: Export env vars**

```bash
export BOB_BUILD_TARGET=node
export BOB_DB_DRIVER=pglite
export BOB_DB_PGLITE_DIR="$HOME/.bob/userdata/db"
export PORT=3100
```

**Step 2: Start the server**

Run: `pnpm --filter @bob/blder start`
Expected: vinext prints "Listening on http://localhost:3100" (or similar) within a few seconds. No crash.

**Step 3: Hit the root in a browser**

Navigate to `http://localhost:3100` in Safari or Chrome.
Expected: blder UI loads. You may need to sign in; that flow depends on how `packages/auth` is configured — for a local-first smoke test, either:
- (a) Temporarily set `REQUIRE_AUTH=false` if supported, or
- (b) Use whatever dev sign-in flow blder supports today.

**Step 4: Verify PGlite persistence**

After creating one piece of data (e.g., a workspace, or even just signing in which should write to the session table):

```bash
ls -la ~/.bob/userdata/db
```

Expected: the directory contains PGlite's data files (size > 0).

**Step 5: Kill and restart server; verify persistence**

Ctrl+C the server, then restart with the same env. The data you created should still be visible in the UI.

**Step 6: Document results**

If smoke test fails, debug and iterate on Tasks 9, 11, or 12 as needed.

If smoke test passes:

```bash
git add . # in case of any small fixes during smoke
git commit -m "feat(blder): Phase 1 end-to-end smoke passes on Node+PGlite" --allow-empty
```

---

## Task 14: Document how to run locally

**Files:**
- Create: `docs/desktop/local-dev.md`

**Step 1: Write the doc**

```markdown
# Running Bob's backend locally on Node + PGlite

This is Phase 1 of the Electron desktop effort — no Electron yet, just the
Node-hosted backend using PGlite as the local database.

## One-time setup

- Node ≥22
- pnpm 10.19.0
- `pnpm install` at repo root

## Running

```bash
export BOB_BUILD_TARGET=node
export BOB_DB_DRIVER=pglite
export BOB_DB_PGLITE_DIR="$HOME/.bob/userdata/db"

pnpm --filter @bob/blder build
pnpm --filter @bob/blder start
```

Open `http://localhost:3100`.

## Reset local data

```bash
rm -rf ~/.bob/userdata/db
```

Migrations are re-applied on next start.

## Switching back to remote Postgres

Unset `BOB_DB_DRIVER` (or set it to `pg`) and set `DATABASE_URL`:

```bash
unset BOB_DB_DRIVER
export DATABASE_URL=postgresql://…
pnpm --filter @bob/blder start
```
```

**Step 2: Commit**

```bash
mkdir -p docs/desktop
git add docs/desktop/local-dev.md
git commit -m "docs(desktop): add Phase 1 local-dev instructions"
```

---

## Risks & Open Questions (revisit during execution)

1. **`drizzle-orm/pglite` sync API**: Task 9 assumes PGlite's drizzle adapter handles `waitReady` internally so we can build a synchronous `db` export. If queries race `waitReady`, swap to a proxy-based wrapper. Surfaces in Task 13.

2. **vinext Node target**: vinext is primarily designed for Cloudflare. The Node target may exercise less-tested code paths. If `BOB_BUILD_TARGET=node` produces a broken bundle, the fallback is to run `vinext dev` (which is already Node-based) as the Phase 1 "server" instead of using a built `start` command. Note this tradeoff in the phase-1 smoke commit if taken.

3. **Auth in local mode**: This plan does not address how auth works when running local-first (GitHub OAuth currently expects production redirect URLs). For Phase 1 smoke we lean on existing dev behavior. A dedicated "Local auth" task belongs in Phase 3 (Connection manager).

4. **Workers-specific imports from tRPC routers**: Some routers may call Workers-only APIs (e.g., `env` bindings, D1, KV). If any are hit during smoke, they need Node-safe fallbacks. Catalog them via test failures in Task 13 rather than pre-empting them now — YAGNI.

5. **`createTRPCContext` db injection**: Explicitly out of scope. The env-var dispatcher in `@bob/db/client` gives us a working path without rewriting every tRPC consumer. If/when ooda wants to inherit from Bob with a different schema, that refactor becomes necessary — handle it then.

---

## Done criteria

- [ ] All new tests in `packages/db` pass
- [ ] `pnpm turbo typecheck` clean
- [ ] `BOB_BUILD_TARGET=node pnpm --filter @bob/blder build` succeeds
- [ ] Manual smoke: UI loads at `http://localhost:3100` with PGlite, data persists across restarts
- [ ] `docs/desktop/local-dev.md` written

When all boxes are checked, Phase 1 is shipped.
