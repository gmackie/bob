import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

const globalForDb = globalThis as unknown as { __bobPgPool?: Pool };

const pool =
  globalForDb.__bobPgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__bobPgPool = pool;
}

export const db: NodePgDatabase<typeof schema> = drizzle(pool, {
  schema,
  casing: "snake_case",
});

export type Db = typeof db;
