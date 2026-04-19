import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate as drizzleMigrate } from "drizzle-orm/pglite/migrator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_FOLDER = resolve(__dirname, "../drizzle");

// Apply all drizzle-generated migrations (in `packages/db/drizzle/`) to the
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
