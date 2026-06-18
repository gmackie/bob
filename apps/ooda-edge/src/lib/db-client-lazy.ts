/**
 * Cloudflare Workers-compatible database client.
 *
 * Uses postgres.js (not node-postgres) because it works natively in Workers.
 * Creates a fresh connection per request (max: 1) because Workers can't reuse
 * TCP sockets across requests. SSL disabled for Hyperdrive (internal connection).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@gmacko/ooda/db/schema";

function getDatabase() {
  const databaseUrl =
    (globalThis as any).DATABASE_URL ??
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const isHyperdrive =
    (globalThis as any).DATABASE_HYPERDRIVE === "true" ||
    process.env.DATABASE_HYPERDRIVE === "true";

  const client = postgres(databaseUrl, {
    ssl: isHyperdrive ? false : "require",
    max: 1,
    // Hyperdrive's pooled mode does not support session-level prepared statements.
    // Without this, postgres.js's prepared-statement cache causes intermittent
    // "Failed query" errors on parameterized inserts.
    prepare: !isHyperdrive,
  });

  return drizzle(client, { schema, casing: "snake_case" });
}

type DatabaseClient = ReturnType<typeof getDatabase>;

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
