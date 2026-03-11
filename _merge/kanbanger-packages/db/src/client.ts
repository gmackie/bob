import { neon } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function createDb() {
  const sql = neon(getEnvVar("DATABASE_URL"));
  return drizzle(sql, { schema });
}

export type Database = NeonHttpDatabase<typeof schema>;

// Singleton instance for server-side usage
let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = createDb();
  }
  return dbInstance;
}

// Export db as a getter that lazily initializes
export const db: Database = new Proxy({} as Database, {
  get(_target, prop: string | symbol) {
    return getDb()[prop as keyof Database];
  },
}) as Database;
