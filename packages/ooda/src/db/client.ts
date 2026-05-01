import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

const sql = postgres(process.env.DATABASE_URL);

export const db = drizzle({
  client: sql,
  schema,
  casing: "snake_case",
});
