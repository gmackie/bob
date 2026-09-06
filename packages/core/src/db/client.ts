import * as schema from "./schema";

export type DatabaseConfig =
  | { driver: "pglite"; dataDir: string }
  | { driver: "postgres"; url: string };

export function readDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const driver = env.GMACKO_DB_DRIVER ?? "pglite";
  if (driver === "postgres") {
    if (!env.DATABASE_URL)
      throw new Error("DATABASE_URL is required for postgres");
    let url: URL;
    try {
      url = new URL(env.DATABASE_URL);
    } catch {
      throw new Error("DATABASE_URL must be a PostgreSQL URL");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      throw new Error("DATABASE_URL must be a PostgreSQL URL");
    }
    return { driver, url: env.DATABASE_URL };
  }
  if (driver !== "pglite")
    throw new Error("GMACKO_DB_DRIVER must be pglite or postgres");
  return { driver, dataDir: env.PGLITE_DATA_DIR ?? `${env.HOME}/.gmacko/data` };
}

export async function createDatabaseConnection(config: DatabaseConfig) {
  if (config.driver === "postgres") {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(config.url);
    return {
      driver: "postgres" as const,
      client,
      db: drizzle(client, { schema }),
      close: () => client.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(config.dataDir);
  return {
    driver: "pglite" as const,
    client,
    db: drizzle(client, { schema }),
    close: () => client.close(),
  };
}
export type DatabaseConnection = Awaited<
  ReturnType<typeof createDatabaseConnection>
>;
export type Database = DatabaseConnection["db"];

// Share the pending connection as well as the resolved handle.
let connection: Promise<DatabaseConnection> | undefined;
export async function getDb(): Promise<Database> {
  connection ??= createDatabaseConnection(readDatabaseConfig()).catch(
    (error) => {
      connection = undefined;
      throw error;
    },
  );
  return (await connection).db;
}
