import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import {
  generateDrizzleJson,
  generateMigration,
} from "drizzle-kit/api";
import * as schema from "./schema.js";
import { applyMigrations } from "./migrate.js";

export type PgliteDbOptions = {
  /** `:memory:` for tests, or an absolute directory path for persistence. */
  dataDir?: string;
  /**
   * If false, skip the from-scratch schema bootstrap AND the subsequent
   * `applyMigrations` pass — the caller is responsible for bringing the
   * database to a usable state. Default true. The only reason to disable is
   * a test that wants a raw, empty PGlite client through the same handle
   * shape (e.g. the `applyMigrations`-against-PGlite test suite, which
   * exercises the migration runner against fixture SQL, not the real schema).
   */
  bootstrap?: boolean;
};

export type PgliteDbHandle = {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
};

const DEFAULT_DIR = path.join(os.homedir(), ".bob", "userdata", "db");

/**
 * Sentinel name used in `bob_migrations` to record that the drizzle-kit
 * from-scratch bootstrap has already taken an empty PGlite to the full schema
 * state described by `schema.ts` + `auth-schema.ts`. Subsequent inits check
 * this marker and skip bootstrap, keeping `makePgliteDb` idempotent across
 * restarts.
 */
const BOOTSTRAP_MARKER = "__pglite_bootstrap__";

/**
 * Bootstrap an empty PGlite instance to the full schema state described by
 * `src/schema.ts` + `src/auth-schema.ts`.
 *
 * Why we can't just reuse `drizzle/*.sql`: those files are incremental patches
 * authored on top of a pre-existing ngi-kanbanger/better-auth baseline — they
 * assume `"user"`, `"session"`, etc. already exist and don't compose into a
 * from-scratch script (see JSDoc on `applyMigrations` in `migrate.ts`).
 *
 * Approach: ask drizzle-kit to diff an empty snapshot against the live schema
 * module exports with `casing: "snake_case"` (matching drizzle.config.ts), then
 * run the resulting DDL against PGlite. After the DDL applies, we record every
 * existing file under `drizzle/` in `bob_migrations` so a later call to
 * `applyMigrations` treats them as already-applied and only runs genuinely new
 * migrations (authored after this snapshot).
 *
 * Idempotent: checks for the `BOOTSTRAP_MARKER` row in `bob_migrations` and
 * no-ops on repeat calls.
 */
export async function bootstrapSchema(client: PGlite): Promise<void> {
  // Ensure the tracking table exists so we can both check for prior bootstrap
  // AND record the sentinel + drizzle files once we're done.
  await client.exec(`
    CREATE TABLE IF NOT EXISTS bob_migrations (
      filename text PRIMARY KEY,
      hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const existing = await client.query<{ filename: string }>(
    `SELECT filename FROM bob_migrations WHERE filename = $1`,
    [BOOTSTRAP_MARKER],
  );
  if (existing.rows.length > 0) {
    return;
  }

  // `schema.ts` already does `export * from "./auth-schema"` so the star-import
  // above includes auth tables (user, session, account, verification). No
  // explicit merge needed.
  const prev = generateDrizzleJson({}, undefined, undefined, "snake_case");
  const cur = generateDrizzleJson(schema, undefined, undefined, "snake_case");
  const statements = await generateMigration(prev, cur);

  // Pre-compute the drizzle/*.sql roster now so the transactional body below
  // has no fs/path async work to do mid-DDL.
  const migrationsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((filename) => {
      const sqlText = fs.readFileSync(
        path.join(migrationsDir, filename),
        "utf8",
      );
      return {
        filename,
        hash: createHash("sha256").update(sqlText).digest("hex"),
      };
    });

  // Wrap all DDL + tracking inserts in a single transaction so a mid-bootstrap
  // failure leaves the DB empty (rolled back) instead of half-created.
  // Without this, a failure at statement N would commit statements 1..N-1 and
  // the next init would crash on "relation already exists" with no sentinel
  // telling us to short-circuit.
  await client.transaction(async (tx) => {
    for (const stmt of statements) {
      await tx.exec(stmt);
    }

    // Record every existing drizzle/*.sql as already applied, so a subsequent
    // `applyMigrations({ client })` call is a no-op on a freshly bootstrapped
    // DB (iterates drizzle/ filenames, finds recorded hashes, skips each).
    for (const { filename, hash } of files) {
      await tx.query(
        `INSERT INTO bob_migrations (filename, hash) VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [filename, hash],
      );
    }

    // Sentinel row — lets future inits detect "bootstrap has already happened
    // on this database" without scanning for every individual table.
    await tx.query(
      `INSERT INTO bob_migrations (filename, hash) VALUES ($1, $2)
       ON CONFLICT (filename) DO NOTHING`,
      [BOOTSTRAP_MARKER, "bootstrap"],
    );
  });
}

export async function makePgliteDb(options: PgliteDbOptions = {}): Promise<PgliteDbHandle> {
  const dataDir = options.dataDir ?? DEFAULT_DIR;

  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir === ":memory:" ? undefined : dataDir);
  await client.waitReady;

  if (options.bootstrap !== false) {
    // Take empty PGlite to the full schema state before anyone can query it.
    await bootstrapSchema(client);

    // `applyMigrations` runs *after* bootstrap so any forward migrations added
    // to `drizzle/` after the schema.ts snapshot still apply. On a freshly
    // bootstrapped DB these are all recorded as already-applied, so this is a
    // no-op. On an upgrade path it picks up the genuinely new files.
    await applyMigrations({ client, log: () => {} });
  }

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}
