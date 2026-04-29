// Chained from db:push via package.json; run standalone with `pnpm migrate:custom`.
/**
 * Custom migration runner for hand-rolled SQL that Drizzle can't generate
 * (e.g., triggers, LISTEN/NOTIFY plumbing, custom functions).
 *
 * Reads all *.sql files under `drizzle/custom/` in lex order and executes each
 * in a single transaction. All SQL is expected to be idempotent (CREATE OR
 * REPLACE for functions; DROP IF EXISTS + CREATE for triggers).
 *
 * Usage (after `pnpm db:push` or `pnpm migrate`):
 *   pnpm --filter @gmacko/ooda migrate:custom
 *
 * Env:
 *   DATABASE_URL — Postgres connection string (same as the rest of the package).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  const customDir = resolve(__dirname, "..", "drizzle", "custom");
  let entries: string[];
  try {
    entries = await readdir(customDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`[migrate-custom] No custom directory at ${customDir}; nothing to do.`);
      return;
    }
    throw err;
  }

  const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();
  if (sqlFiles.length === 0) {
    console.log("[migrate-custom] No *.sql files in custom dir; nothing to do.");
    return;
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const file of sqlFiles) {
      const path = join(customDir, file);
      const contents = await readFile(path, "utf8");
      const trimmed = contents.trim();
      if (trimmed.length === 0) {
        console.log(`[migrate-custom] ${file}: skipped (empty)`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
      });
      console.log(`[migrate-custom] ${file}: applied`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrate-custom] failed:", err);
  process.exit(1);
});
