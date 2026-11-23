/**
 * Cloudflare Workers-compatible database client.
 *
 * Uses postgres.js (not node-postgres) and AsyncLocalStorage to scope one
 * drizzle client per request. The worker entry calls `runWithDb()` to set
 * up the request-scoped client; the Proxy reads it on every access.
 */
import { tracePostgres } from "@gmacko/core/telemetry/database";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@bob/db/schema";

type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

const als = new AsyncLocalStorage<DatabaseClient>();

/** A drizzle client and a way to close its connection. */
export interface ClosableDb {
  db: DatabaseClient;
  end: (options: { timeout: number }) => Promise<void>;
}

function openDb(databaseUrl: string, isHyperdrive: boolean): ClosableDb {
  const client = postgres(databaseUrl, {
    ssl: isHyperdrive ? false : "require",
    max: 1,
    prepare: !isHyperdrive,
  });
  return {
    db: drizzle(tracePostgres(client), { schema, casing: "snake_case" }),
    end: (options) => client.end(options),
  };
}

export function createDbClient(databaseUrl: string, isHyperdrive: boolean): DatabaseClient {
  return openDb(databaseUrl, isHyperdrive).db;
}

export function runWithDb<T>(databaseUrl: string, isHyperdrive: boolean, fn: () => T): T {
  const client = createDbClient(databaseUrl, isHyperdrive);
  return als.run(client, fn);
}

/**
 * runWithDb for a long-lived isolate (a Durable Object), which, unlike a request, is not
 * torn down when the work ends: the connection is closed after `fn` settles, success or
 * error. Request paths keep runWithDb. `open` is for tests.
 */
export async function runWithDbClosing<T>(
  databaseUrl: string,
  isHyperdrive: boolean,
  fn: () => Promise<T>,
  open: (databaseUrl: string, isHyperdrive: boolean) => ClosableDb = openDb,
): Promise<T> {
  const { db: client, end } = open(databaseUrl, isHyperdrive);
  try {
    return await als.run(client, fn);
  } finally {
    await end({ timeout: 5 }).catch((error: unknown) => {
      console.warn("[db] closing the connection failed:", error instanceof Error ? error.message : error);
    });
  }
}

function getDb(): DatabaseClient {
  const fromAls = als.getStore();
  if (fromAls) return fromAls;

  const databaseUrl =
    (globalThis as any).DATABASE_URL ??
    process.env.DATABASE_URL;

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
    const instance = getDb();
    const value = (instance as any)[prop as string];
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});

export type Db = typeof db;
