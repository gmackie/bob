import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Create an in-memory PGlite + Drizzle client for tests.
// Returns a disposable db + a teardown fn.
export async function createTestDb() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmacko-db-test-"));
  const pglite = new PGlite(tmpDir);
  const db = drizzle(pglite, { schema });

  return {
    db,
    pglite,
    teardown: async () => {
      await pglite.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

// Apply all pending migrations against the test db.
// Currently reads the raw-DDL migrate script output.
export async function applyTestMigrations(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
) {
  // Will be implemented after Task 11 generates the first migration.
  // For per-table tests in Tasks 5-9, DDL is applied via Drizzle's push
  // behavior — the test file uses `drizzle-kit push` equivalent via the
  // raw SQL from the table definitions.
  // Placeholder: a future iteration will read from `packages/db/drizzle/*.sql`
  // and execute them in order.
  throw new Error("applyTestMigrations not yet implemented — see Task 11");
}
