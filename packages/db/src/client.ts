import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://gmacko:gmacko@localhost:5432/gmacko";
const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });
export type Database = typeof db;
