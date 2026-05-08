import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

const isHyperdrive = process.env.DATABASE_HYPERDRIVE === "true";

const sql = postgres(process.env.DATABASE_URL, {
  ...(isHyperdrive ? { prepare: false, ssl: false, max: 1 } : {}),
});

export const db = drizzle({
  client: sql,
  schema,
  casing: "snake_case",
});
