import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create an in-memory PGlite + Drizzle client for tests.
// Returns a disposable db + a teardown fn.
// By default, applies all generated migrations in packages/db/drizzle/.
export async function createTestDb(opts?: { applyMigrations?: boolean }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmacko-db-test-"));
  const pglite = new PGlite(tmpDir);
  const db = drizzle(pglite, { schema });

  if (opts?.applyMigrations ?? true) {
    await applyTestMigrations(pglite);
  }

  return {
    db,
    pglite,
    teardown: async () => {
      await pglite.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

// Apply all drizzle-generated migrations (in `packages/db/drizzle/`) to the
// provided PGlite instance, in filename-sorted order. Splits on drizzle's
// `--> statement-breakpoint` delimiter so each SQL statement runs individually
// (PGlite's `exec` can be finicky with multi-statement strings that mix DDL
// and constraint management).
export async function applyTestMigrations(pglite: PGlite) {
  const migrationsDir = path.resolve(__dirname, "../../drizzle");
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pglite.exec(statement);
    }
  }
}
