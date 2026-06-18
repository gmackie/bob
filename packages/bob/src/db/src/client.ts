/**
 * Environment-dispatched db client.
 *
 * Selects a driver at module-load time based on `BOB_DB_DRIVER`:
 *   - unset or "pg"  → node-postgres (production / default)
 *   - "pglite"       → in-process @electric-sql/pglite (local-first / Electron)
 *
 * The `db` export stays synchronous so existing consumers
 * (`import { db } from "@bob/db/client"` in tRPC routers, services, etc.)
 * keep working without a context refactor. For the pglite path we use a
 * ready-promise proxy (see `makePgliteDbSync` in `./client-pglite.ts`) so
 * queries fired immediately after import still wait for bootstrap to
 * complete under the hood.
 *
 * Module-cache constraint: because the driver is chosen once at top-level,
 * a single vitest worker will lock in whichever driver was selected the
 * first time this module is imported. Tests that need to exercise both
 * branches must call `vi.resetModules()` between env-var mutations; see
 * `client-dispatcher.test.ts` for the pattern.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";

import { makePgliteDbSync } from "./client-pglite";
import * as schema from "./schema";

/**
 * Public `db` shape. We keep this as `NodePgDatabase<typeof schema>` rather
 * than a `pg | pglite` union so every existing tRPC-layer consumer that
 * chains `.insert(...).values(...).returning({ ... })` etc. still typechecks
 * against a single concrete driver type — union method signatures from
 * drizzle-orm don't always intersect cleanly (e.g. `.returning(selection)`).
 *
 * At runtime, when `BOB_DB_DRIVER=pglite` we return a `PgliteDatabase` cast
 * through this type. The two adapters are structurally close enough for every
 * consumer path we exercise today; any pg-only affordance (e.g. `.rowCount`
 * on an update result) is already rare and out-of-band in the codebase.
 *
 * If a real runtime divergence surfaces, the right move is a narrow helper
 * here — NOT widening the consumer type back to a union (we tried; it
 * cascades into ~15 sites in `@bob/api`).
 */
export type Db = NodePgDatabase<typeof schema>;

function initPgDb(): NodePgDatabase<typeof schema> {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL environment variable");
  }
  return drizzleNodePg({
    connection: process.env.DATABASE_URL,
    schema,
    casing: "snake_case",
  });
}

function initDb(): Db {
  const driver = process.env.BOB_DB_DRIVER ?? "pg";

  if (driver === "pglite") {
    return makePgliteDbSync({
      dataDir: process.env.BOB_DB_PGLITE_DIR,
    }) as unknown as Db;
  }

  if (driver === "pg") {
    return initPgDb();
  }

  throw new Error(
    `Unknown BOB_DB_DRIVER: "${driver}". Expected "pg" or "pglite".`,
  );
}

export const db: Db = initDb();
