/**
 * Cloudflare Workers-compatible database client.
 *
 * Uses postgres.js (not node-postgres) because it works natively in Workers.
 *
 * Request scoping: the worker entry calls `runWithDb()` once per request, which
 * creates ONE postgres client (max: 1) and stashes it in an AsyncLocalStorage
 * store. Every `db.*` access during that request — better-auth's `getSession`,
 * the tRPC context, programmatic apiKey validation — reads that same client, so
 * a request opens a single Hyperdrive connection instead of a fresh one per
 * property access. The per-access churn was tipping requests over Hyperdrive's
 * per-invocation connection limit (surfacing as `Hyperdrive config not found`,
 * pg 58000) once the apiKey lookup ran after `getSession`.
 *
 * The ALS instance is anchored on `globalThis` on purpose: the worker entry
 * (`worker/index.js`) and the vinext server bundle are built separately, so a
 * module-local `als` would be a DIFFERENT instance in each and the store set by
 * `runWithDb` (worker) would be invisible to `getDb` (app). One shared ALS on
 * globalThis guarantees they read/write the same store regardless of how many
 * bundled copies of this module exist in the isolate.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@gmacko/ooda/db/schema";

type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

const als: AsyncLocalStorage<DatabaseClient> =
  ((globalThis as any).__oodaEdgeDbAls ??=
    new AsyncLocalStorage<DatabaseClient>());

export function createDbClient(
  databaseUrl: string,
  isHyperdrive: boolean,
): DatabaseClient {
  const client = postgres(databaseUrl, {
    ssl: isHyperdrive ? false : "require",
    max: 1,
    // Hyperdrive's pooled mode does not support session-level prepared
    // statements; without this, postgres.js's prepared-statement cache causes
    // intermittent "Failed query" errors on parameterized inserts.
    prepare: !isHyperdrive,
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

/**
 * Run `fn` with a request-scoped DB client bound to the ALS store. The worker
 * entry wraps the whole request handler in this so every `db.*` access shares
 * one connection.
 */
export function runWithDb<T>(
  databaseUrl: string,
  isHyperdrive: boolean,
  fn: () => T,
): T {
  const client = createDbClient(databaseUrl, isHyperdrive);
  return als.run(client, fn);
}

function getDatabase(): DatabaseClient {
  const fromAls = als.getStore();
  if (fromAls) return fromAls;

  // Fallback for any code that touches `db` outside a `runWithDb` scope (module
  // init, non-request paths). Reads the env the worker set from the Hyperdrive
  // binding. This still creates a client per access, but the request path is
  // always ALS-scoped, so it's off the hot path.
  const databaseUrl =
    (globalThis as any).DATABASE_URL ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const isHyperdrive =
    (globalThis as any).DATABASE_HYPERDRIVE === "true" ||
    process.env.DATABASE_HYPERDRIVE === "true";

  return createDbClient(databaseUrl, isHyperdrive);
}

export const db = new Proxy({} as DatabaseClient, {
  get(_target, prop) {
    const dbClient = getDatabase();
    const value = (dbClient as any)[prop as string];
    if (typeof value === "function") {
      return value.bind(dbClient);
    }
    return value;
  },
});

export type Db = typeof db;
