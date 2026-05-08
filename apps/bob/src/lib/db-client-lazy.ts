/**
 * Cloudflare Workers-compatible database client.
 *
 * Uses postgres.js (not node-postgres) and AsyncLocalStorage to scope one
 * drizzle client per request. The worker entry calls `runWithDb()` to set
 * up the request-scoped client; the Proxy reads it on every access.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@bob/db/schema";

type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>;

const als = new AsyncLocalStorage<DatabaseClient>();

export function createDbClient(databaseUrl: string, isHyperdrive: boolean): DatabaseClient {
  const client = postgres(databaseUrl, {
    ssl: isHyperdrive ? false : "require",
    max: 1,
    prepare: !isHyperdrive,
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

export function runWithDb<T>(databaseUrl: string, isHyperdrive: boolean, fn: () => T): T {
  const client = createDbClient(databaseUrl, isHyperdrive);
  return als.run(client, fn);
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
