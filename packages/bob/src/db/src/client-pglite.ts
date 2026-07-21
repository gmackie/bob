import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle  } from "drizzle-orm/pglite";
import type {PgliteDatabase} from "drizzle-orm/pglite";
import {
  generateDrizzleJson,
  generateMigration,
} from "drizzle-kit/api";
import * as schema from "./schema.js";
import { applyMigrations, noop } from "./migrate.js";

export interface PgliteDbOptions {
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
}

export interface PgliteDbHandle {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
}

const DEFAULT_DIR = path.join(os.homedir(), ".bob", "userdata", "db");

/**
 * Resolve the directory containing forward `drizzle/*.sql` migration files.
 *
 * Priority order:
 *   1. `BOB_DB_MIGRATIONS_DIR` env var — explicit override. Required when the
 *      caller lives in a bundled context (e.g. vinext SSR) where
 *      `import.meta.url` points at the emitted bundle path, not the original
 *      source file. Phase 2's `apps/bob-server` will set this to the on-disk
 *      location of `packages/db/drizzle/`.
 *   2. Source-relative fallback — `packages/db/drizzle/` resolved from this
 *      file's own location. Correct for the tsx / direct-import path (tests,
 *      CLI, non-bundled runtimes).
 *
 * Callers should treat a missing directory as non-fatal; the from-scratch
 * bootstrap DDL (see `bootstrapSchema`) already takes empty PGlite to the full
 * schema state, and the pre-mark-applied pass is only an optimization for the
 * `applyMigrations` follow-up.
 */
export function resolveMigrationsDir(): string {
  const override = process.env.BOB_DB_MIGRATIONS_DIR;
  if (override && override.length > 0) return override;
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );
}

/**
 * Sentinel name used in `bob_migrations` to record that the drizzle-kit
 * from-scratch bootstrap has already taken an empty PGlite to the full schema
 * state described by `schema.ts` (which re-exports `@bob/auth/schema` and
 * other area schemas). Subsequent inits check
 * this marker and skip bootstrap, keeping `makePgliteDb` idempotent across
 * restarts.
 */
const BOOTSTRAP_MARKER = "__pglite_bootstrap__";

/**
 * Bootstrap an empty PGlite instance to the full schema state described by
 * `src/schema.ts` (which re-exports `@bob/auth/schema` + other area schemas).
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

  // The schema barrel exports both singular aliases (user, session, account,
  // verification) and canonical plural names (users, sessions, accounts,
  // verifications) — the same pgTable objects under two keys. drizzle-kit's
  // `generateDrizzleJson` treats each key as a distinct table and chokes on
  // the duplicate index names. Deduplicate by object identity before passing.
  const seen = new Set<unknown>();
  const deduped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped[key] = value;
  }
  // drizzle-kit@0.31's bundled `api.d.ts` declares these return types against
  // Zod v3 internals (ZodObject/ZodArray generic arity, `objectOutputType`,
  // etc.), which don't resolve cleanly against this workspace's zod v4 —  a
  // real third-party type-declaration mismatch, not an untyped value in our
  // code. `prev`/`cur` are opaque snapshot blobs we only ever pass straight
  // into `generateMigration`/drizzle-kit's own APIs; we never inspect their
  // shape, so there's nothing here to narrow with a runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- drizzle-kit d.ts vs zod v4 mismatch, see comment above
  const prev = generateDrizzleJson({}, undefined, undefined, "snake_case");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- drizzle-kit d.ts vs zod v4 mismatch, see comment above
  const cur = generateDrizzleJson(deduped, undefined, undefined, "snake_case");
  const statements = await generateMigration(prev, cur);

  // Pre-compute the drizzle/*.sql roster now so the transactional body below
  // has no fs/path async work to do mid-DDL.
  //
  // Tolerate a missing dir: the from-scratch DDL from `generateMigration` below
  // has already applied the full schema, so pre-marking every drizzle/*.sql as
  // applied is only an optimization for the `applyMigrations` follow-up. In a
  // bundled context (vinext SSR) the source-relative fallback of
  // `resolveMigrationsDir()` can't reach the original files, and that's fine —
  // we log and move on. The env-var override exists so properly-packaged hosts
  // (e.g. Phase 2's `apps/bob-server`) can still opt in to the optimization.
  const migrationsDir = resolveMigrationsDir();
  let files: { filename: string; hash: string }[] = [];
  try {
    files = fs
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
  } catch (err) {
    const isEnoent =
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT";
    if (!isEnoent) throw err;

    console.warn(
      `[@bob/db] migrations dir not found at ${migrationsDir}; ` +
        `skipping pre-mark step. Set BOB_DB_MIGRATIONS_DIR to opt in. ` +
        `(Non-fatal — the from-scratch DDL has already applied the full schema.)`,
    );
  }

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
    //
    // Pass the resolved migrations dir through so bundled hosts (vinext SSR)
    // honour `BOB_DB_MIGRATIONS_DIR`; `applyMigrations` also tolerates a
    // missing dir via `loadMigrations`, so this stays a no-op when neither the
    // env var nor the source-relative default resolves.
    await applyMigrations({
      client,
      log: noop,
      migrationsDir: resolveMigrationsDir(),
    });
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

/**
 * Wrap a PGlite client so every query-surface method awaits `ready` before
 * delegating. This closes the race window that would otherwise exist between
 * constructing a synchronous `db` export and finishing the async bootstrap +
 * applyMigrations pipeline: consumers (tRPC routers imported via
 * `@bob/db/client`) can fire a query immediately after module evaluation and
 * the query will transparently wait for bootstrap to complete.
 *
 * Only the query/exec/transaction surface is gated. Other properties (e.g.
 * `waitReady`, `closed`, internal symbols drizzle-orm inspects to determine
 * the client shape) pass through untouched — gating them would break drizzle
 * adapter detection.
 */
function gateOnReady(client: PGlite, ready: Promise<void>): PGlite {
  return new Proxy(client, {
    get(target, prop, receiver): unknown {
      const original: unknown = Reflect.get(target, prop, receiver);

      // Gate only the three async entry points drizzle-orm/pglite uses
      // to run SQL. Everything else (property access, sync getters,
      // internal markers) must pass through for drizzle's own driver
      // detection and for close()/waitReady to behave.
      if (prop === "query" || prop === "exec" || prop === "transaction") {
        return async (...args: unknown[]) => {
          await ready;
          return (original as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
        };
      }

      return typeof original === "function"
        ? (original as (...a: unknown[]) => unknown).bind(target)
        : original;
    },
  });
}

/**
 * Synchronous factory used by the env-dispatched `@bob/db/client`.
 *
 * Returns a drizzle instance immediately (no top-level await) backed by a
 * PGlite client whose query/exec/transaction methods transparently await a
 * shared `ready` promise. That promise resolves once:
 *   1. `client.waitReady` resolves (PGlite WASM is initialized)
 *   2. `bootstrapSchema` has taken an empty DB to the full target schema
 *   3. `applyMigrations` has applied any forward migrations authored after
 *      the schema.ts snapshot
 *
 * This keeps consumers' `import { db } from "@bob/db/client"` usage fully
 * synchronous while preventing the "query fires before bootstrap completes"
 * race — callers can query `db` on the same tick it's imported.
 */
export function makePgliteDbSync(
  options: PgliteDbOptions = {},
): PgliteDatabase<typeof schema> {
  const dataDir = options.dataDir ?? DEFAULT_DIR;

  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const client = new PGlite(dataDir === ":memory:" ? undefined : dataDir);

  const ready = (async () => {
    await client.waitReady;
    if (options.bootstrap !== false) {
      await bootstrapSchema(client);
      // Same migrations-dir story as `makePgliteDb` above: honour the env-var
      // override for bundled hosts, tolerate a missing dir (no-op).
      await applyMigrations({
        client,
        log: noop,
        migrationsDir: resolveMigrationsDir(),
      });
    }
  })();

  // Surface any bootstrap failure: every gated call still awaits `ready` and
  // will reject with the underlying error, but if nothing ever calls the db
  // we still want the root cause visible in logs rather than silenced.
  ready.catch((err: unknown) => {

    console.error("[@bob/db] PGlite bootstrap failed:", err);
  });

  // Register a shutdown hook so persistent PGlite instances flush cleanly
  // when the host process exits. In-memory dbs are a no-op to close but the
  // hook is harmless. Handles both graceful exit (`beforeExit`) and signal
  // termination (SIGINT/SIGTERM — relevant for Electron-spawned bob-server).
  let closed = false;
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    try {
      await client.close();
    } catch (err) {

      console.error("[@bob/db] PGlite close failed:", err);
    }
  };
  if (typeof process !== "undefined" && typeof process.once === "function") {
    process.once("beforeExit", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  }

  const gatedClient = gateOnReady(client, ready);
  return drizzle(gatedClient, { schema });
}
