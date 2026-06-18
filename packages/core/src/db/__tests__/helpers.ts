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
// By default, applies all generated migrations in packages/core/drizzle/.
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

// Sort drizzle migration filenames by their leading numeric prefix.
// Drizzle's convention is a 4-digit-padded number (`0000_*`, `0001_*`, ...),
// so lexicographic sort is correct up to 9999 migrations; the numeric sort
// here is defensive and documents intent. Ties and unparseable entries fall
// back to lexicographic ordering. Returns a new array; does not mutate input.
export function sortMigrationFiles(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const am = a.match(/^(\d+)_/);
    const bm = b.match(/^(\d+)_/);
    if (am && bm) {
      const an = Number(am[1]);
      const bn = Number(bm[1]);
      if (an !== bn) return an - bn;
    } else if (am && !bm) {
      return -1;
    } else if (!am && bm) {
      return 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// Apply all drizzle-generated migrations (in `packages/core/drizzle/`) to the
// provided PGlite instance, in numeric-prefix-sorted order. Splits on drizzle's
// `--> statement-breakpoint` delimiter so each SQL statement runs individually
// (PGlite's `exec` can be finicky with multi-statement strings that mix DDL
// and constraint management).
//
// Throws if the migrations directory contains zero .sql files — a silent pass
// on an empty glob would mean tests run against an empty schema and give false
// positives.
export async function applyTestMigrations(
  pglite: PGlite,
  options?: { migrationsDir?: string },
) {
  const migrationsDir = options?.migrationsDir ?? path.resolve(__dirname, "../../../drizzle");
  const entries = await fs.readdir(migrationsDir);
  const files = sortMigrationFiles(entries.filter((f) => f.endsWith(".sql")));
  if (files.length === 0) {
    throw new Error(`applyTestMigrations: no migrations (.sql files) found in ${migrationsDir}`);
  }
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
