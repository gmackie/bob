import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Capture only initdb's output. Each fixture restores its own filesystem and
// runs migrations independently. Vitest's module isolation bounds the cache.
let emptyCluster: Promise<Blob> | undefined;

async function snapshotEmptyCluster() {
  const seed = await PGlite.create();
  try {
    return await seed.dumpDataDir("none");
  } finally {
    await seed.close();
  }
}

export async function createTestDb(opts?: { applyMigrations?: boolean }) {
  emptyCluster ??= snapshotEmptyCluster().catch((error) => {
    emptyCluster = undefined;
    throw error;
  });
  const pglite = await PGlite.create({ loadDataDir: await emptyCluster });
  try {
    if (opts?.applyMigrations ?? true) {
      await applyTestMigrations(pglite);
    }
    return {
      db: drizzle(pglite, { schema }),
      pglite,
      teardown: () => pglite.close(),
    };
  } catch (error) {
    await pglite.close();
    throw error;
  }
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
