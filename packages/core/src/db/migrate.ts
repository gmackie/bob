import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate as drizzleMigrate } from "drizzle-orm/pglite/migrator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  createDatabaseConnection,
  type DatabaseConfig,
  type DatabaseConnection,
} from "./client";

const MIGRATIONS_FOLDER = resolve(__dirname, "../../drizzle");

// Apply all drizzle-generated migrations (in `packages/core/drizzle/`) to the
// given PGlite instance, using drizzle's built-in migrator.
//
// The migrator tracks applied migrations in a `__drizzle_migrations` table, so
// this is safe to re-run against a persistent PGlite data directory — already
// applied migrations are skipped. The previous raw-SQL version re-executed
// every statement on every call and would throw "relation already exists" on
// the second invocation.
export async function runMigrations(pglite: PGlite): Promise<void> {
  const db = drizzle(pglite);
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Initialize once per manager, including migrations; failed attempts close and can retry. */
export function createDatabaseManager(
  config: DatabaseConfig,
  dependencies: {
    connect?: typeof createDatabaseConnection;
    migrate?: (connection: DatabaseConnection) => Promise<void>;
  } = {},
) {
  let pending: Promise<DatabaseConnection> | undefined;
  let closing: Promise<void> | undefined;
  function get(): Promise<DatabaseConnection> {
    if (closing) return closing.then(get);
    if (!pending)
      pending = (async () => {
        const connection = await (
          dependencies.connect ?? createDatabaseConnection
        )(config);
        try {
          if (dependencies.migrate) await dependencies.migrate(connection);
          else if (connection.driver === "pglite")
            await runMigrations(connection.client);
          else {
            const { migrate } =
              await import("drizzle-orm/postgres-js/migrator");
            await migrate(connection.db, {
              migrationsFolder: MIGRATIONS_FOLDER,
            });
          }
          return connection;
        } catch (error) {
          await connection.close();
          throw error;
        }
      })().catch((error) => {
        pending = undefined;
        throw error;
      });
    return pending;
  }
  function close(): Promise<void> {
    if (closing) return closing;
    const active = pending;
    closing = (async () => {
      if (active) await (await active).close();
    })().finally(() => {
      pending = undefined;
      closing = undefined;
    });
    return closing;
  }
  return { get, close };
}

// Backwards-compatible alias for the previous export name.
export const migrate = runMigrations;

// CLI entry — preserves the `db:migrate:pglite` package script. Reads
// PGLITE_DATA_DIR (default `~/.gmacko/data`) and applies migrations against it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir =
    process.env.PGLITE_DATA_DIR ?? `${process.env.HOME}/.gmacko/data`;
  const pglite = new PGlite(dataDir);
  runMigrations(pglite)
    .then(() => {
      console.log("Migrations applied");
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exitCode = 1;
    })
    .finally(() => {
      void pglite.close();
    });
}
