#!/usr/bin/env tsx
/**
 * Forward-only SQL migration runner.
 *
 * Reads packages/db/drizzle/*.sql in filename order, applies any that haven't
 * been recorded in the `bob_migrations` tracking table, and records the file's
 * sha256 hash. Each migration runs in its own transaction.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm -F @bob/db migrate
 *   DATABASE_URL=postgres://... pnpm -F @bob/db migrate --bootstrap
 *
 * --bootstrap marks every SQL file as applied WITHOUT running it. Use once,
 * against a database whose schema already matches the final state of the files.
 *
 * --dry-run prints what would be applied without touching the DB.
 *
 * The core `applyMigrations({ client })` function is also exported for use
 * against any client that exposes `.query(sql, params?) => { rows: [] }` —
 * notably pg.Client and @electric-sql/pglite, for Electron / PGlite mode.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface MigrationFile {
  filename: string;
  path: string;
  sql: string;
  hash: string;
}

function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((filename) => {
    const path = join(dir, filename);
    const sql = readFileSync(path, "utf8");
    return { filename, path, sql, hash: sha256(sql) };
  });
}

/**
 * Minimal client shape shared by `pg.Client` and `@electric-sql/pglite`.
 * Both accept a SQL string + optional positional params and return `{ rows }`.
 *
 * `exec` is optional: PGlite exposes it for multi-statement SQL (its `query`
 * only accepts a single statement because it goes through prepared statements).
 * pg.Client does NOT have `exec`, but its `query(sql)` without params happily
 * runs multi-statement SQL, so we fall back to that when `exec` is absent.
 */
export type MigrationClient = {
  query<R = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
  exec?: (sql: string) => Promise<unknown>;
};

/**
 * Run a (possibly multi-statement) migration SQL blob against the client.
 * Prefers `exec` when available (PGlite); otherwise falls back to `query` with
 * no params, which is how pg.Client handles multi-statement SQL.
 */
async function runMigrationSql(
  client: MigrationClient,
  sqlText: string,
): Promise<void> {
  // Invariant: migration SQL is DDL-only (drizzle-kit emits no bound params).
  // Both branches below are paramless on purpose; do not extend this helper
  // to accept params without also rethinking the multi-statement case.
  if (typeof client.exec === "function") {
    await client.exec(sqlText);
    return;
  }
  await client.query(sqlText);
}

export type ApplyMigrationsOptions = {
  client: MigrationClient;
  /** If true, record migrations as applied WITHOUT running their SQL. */
  bootstrap?: boolean;
  /** If true, log intended actions but make no changes. */
  dryRun?: boolean;
  /** Optional logger; defaults to console. Pass `() => {}` to silence. */
  log?: (msg: string) => void;
  /**
   * Directory containing the forward `*.sql` migration files. Defaults to
   * `packages/db/drizzle/` (resolved relative to this file).
   */
  migrationsDir?: string;
};

/**
 * Apply pending forward migrations against the given client.
 *
 * Works against any client conforming to {@link MigrationClient} — currently
 * `pg.Client` (production) and `PGlite` (local-first Electron mode).
 *
 * Each migration runs inside its own transaction; the tracking row is inserted
 * in the same transaction so partial application cannot corrupt state.
 *
 * Immutability invariant: if a file is already recorded in `bob_migrations`
 * with a different hash than its current contents, this throws — migrations
 * are append-only, never edit-in-place.
 *
 * NOTE: this function deliberately does NOT take out the pg advisory lock
 * used by the CLI wrapper, because advisory locks are pg-specific and
 * unsupported by PGlite. CLI callers wrap this with advisory locking in
 * `main()`; other callers (e.g. auto-migrate on PGlite init) don't need it.
 *
 * IMPORTANT — empty-DB bootstrap gap: the files under `packages/db/drizzle/`
 * today are incremental patches authored on top of a pre-existing
 * ngi-kanbanger/better-auth baseline. They DO NOT compose into a from-scratch
 * schema and will fail if pointed at an empty PGlite (or any empty pg DB).
 * Task 7 of the Electron Phase 1 plan wires a schema-bootstrap path onto
 * PGlite init to close this gap; until then, callers targeting empty
 * databases should pass a `migrationsDir` of their own prepared fixtures.
 */
export async function applyMigrations(
  options: ApplyMigrationsOptions,
): Promise<void> {
  const {
    client,
    bootstrap = false,
    dryRun = false,
    migrationsDir = MIGRATIONS_DIR,
  } = options;
  const log = options.log ?? ((msg: string) => console.log(msg));

  const migrations = loadMigrations(migrationsDir);

  await client.query(`
    CREATE TABLE IF NOT EXISTS bob_migrations (
      filename text PRIMARY KEY,
      hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedResult = await client.query<{ filename: string; hash: string }>(
    `SELECT filename, hash FROM bob_migrations`,
  );
  const appliedMap = new Map(
    appliedResult.rows.map((r) => [r.filename, r.hash]),
  );

  // Sanity check: already-applied files must match recorded hash.
  for (const m of migrations) {
    const recorded = appliedMap.get(m.filename);
    if (recorded && recorded !== m.hash) {
      throw new Error(
        `Migration immutability violation: ${m.filename} already applied ` +
          `but its hash has changed.\n  recorded: ${recorded}\n  current:  ${m.hash}\n` +
          `Migrations are append-only. Create a new file instead of editing this one.`,
      );
    }
  }

  const pending = migrations.filter((m) => !appliedMap.has(m.filename));
  if (pending.length === 0) {
    log("No pending migrations. Schema is up to date.");
    return;
  }

  if (bootstrap) {
    log(
      `Bootstrap: marking ${pending.length} migration(s) as applied without running them:`,
    );
    for (const m of pending) log(`  ✓ ${m.filename}`);
    if (dryRun) {
      log("(dry-run, no changes written)");
      return;
    }
    await client.query("BEGIN");
    try {
      for (const m of pending) {
        await client.query(
          `INSERT INTO bob_migrations (filename, hash) VALUES ($1, $2)`,
          [m.filename, m.hash],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    log("Bootstrap complete.");
    return;
  }

  log(`Applying ${pending.length} pending migration(s):`);
  for (const m of pending) log(`  → ${m.filename}`);
  if (dryRun) {
    log("(dry-run, no changes written)");
    return;
  }

  for (const m of pending) {
    log(`\n==> ${m.filename}`);
    try {
      await client.query("BEGIN");
      await runMigrationSql(client, m.sql);
      await client.query(
        `INSERT INTO bob_migrations (filename, hash) VALUES ($1, $2)`,
        [m.filename, m.hash],
      );
      await client.query("COMMIT");
      log("    ✓ applied");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `Migration ${m.filename} failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  log("\nAll migrations applied.");
}

/**
 * CLI wrapper: connect to Postgres using `DATABASE_URL`, take the
 * cross-process advisory lock, and run {@link applyMigrations}.
 *
 * The advisory lock serializes concurrent `pnpm migrate` runs (e.g. blder
 * and ws-gateway deploys racing each other). It is intentionally kept out
 * of `applyMigrations` itself so the PGlite / local-first path can reuse
 * the same logic without needing Postgres-only primitives.
 */
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const BOOTSTRAP = args.has("--bootstrap");
  const DRY_RUN = args.has("--dry-run");

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  console.log(
    `Found ${loadMigrations().length} migration file(s) in ${MIGRATIONS_DIR}`,
  );

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Advisory lock: serialize concurrent migrate runs (e.g. blder + ws-gateway
    // deploys racing). Released automatically when the connection ends.
    // Lock key is an arbitrary 64-bit int picked once for this tool.
    await client.query(`SELECT pg_advisory_lock(8823427361421345)`);

    await applyMigrations({
      client,
      bootstrap: BOOTSTRAP,
      dryRun: DRY_RUN,
    });
  } finally {
    await client.end();
  }
}

// Only run the CLI when this file is executed directly (e.g. via tsx / node),
// NOT when imported by tests. Using import.meta.url vs process.argv[1] is the
// standard ESM equivalent of `require.main === module`.
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      fileURLToPath(import.meta.url) === resolve(process.argv[1]) ||
      // tsx resolves to the .ts file even when the entry is symlinked; cover it.
      import.meta.url.endsWith("/migrate.ts") &&
        process.argv[1].endsWith("migrate.ts")
    );
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error("Migration runner failed:", err);
    process.exit(1);
  });
}
