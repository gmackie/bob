import * as schema from "./schema";

const DB_DRIVER = process.env.GMACKO_DB_DRIVER ?? "pglite";

async function createDb() {
  if (DB_DRIVER === "postgres") {
    // Production: connect to external PostgreSQL
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const connectionString =
      process.env.DATABASE_URL ??
      "postgres://gmacko:gmacko@localhost:5432/gmacko";
    const sql = postgres(connectionString);
    return drizzle(sql, { schema });
  }

  // Default: PGlite (WASM Postgres, no server needed)
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dataDir =
    process.env.PGLITE_DATA_DIR ??
    `${process.env.HOME}/.gmacko/data`;
  const client = new PGlite(dataDir);
  return drizzle(client, { schema });
}

// Lazy singleton
let _db: Awaited<ReturnType<typeof createDb>> | undefined;

export async function getDb() {
  if (!_db) {
    _db = await createDb();
  }
  return _db;
}

// Synchronous export for backwards compat — will be the PGlite instance once initialized
// Prefer getDb() for new code
export type Database = Awaited<ReturnType<typeof createDb>>;
