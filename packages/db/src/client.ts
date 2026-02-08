import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

export const db: NodePgDatabase<typeof schema> = drizzle({
  connection: process.env.DATABASE_URL,
  schema,
  casing: "snake_case",
});

export type Db = typeof db;
