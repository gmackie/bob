import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getDb } from "./client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Apply all drizzle-generated migrations (in `packages/db/drizzle/`) to the
// active db client, in filename-sorted order. Splits on drizzle's
// `--> statement-breakpoint` delimiter so each statement runs individually.
//
// This replaces the previous inline raw-DDL migrate script — the source of
// truth for schema is now `packages/db/src/schema/` via `drizzle-kit generate`.
export async function migrate() {
  const db = await getDb();
  const migrationsDir = path.resolve(__dirname, "../drizzle");
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const fileSql = await fs.readFile(
      path.join(migrationsDir, file),
      "utf8",
    );
    const statements = fileSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
  }
  console.log(`Applied ${files.length} migration file(s)`);
}

// Allow running directly via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
