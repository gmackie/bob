#!/usr/bin/env tsx
/**
 * Forward-only SQL migration runner.
 *
 * Reads packages/db/drizzle/*.sql in filename order, applies any that haven't
 * been recorded in the `bob_migrations` tracking table, and records the file's
 * sha256 hash. Each migration runs in its own transaction.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm -F @bob/db migrate
 *   DATABASE_URL=postgres://... pnpm -F @bob/db migrate --bootstrap
 *
 * --bootstrap marks every SQL file as applied WITHOUT running it. Use once,
 * against a database whose schema already matches the final state of the files.
 *
 * --dry-run prints what would be applied without touching the DB.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

const args = new Set(process.argv.slice(2));
const BOOTSTRAP = args.has("--bootstrap");
const DRY_RUN = args.has("--dry-run");

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface MigrationFile {
  filename: string;
  path: string;
  sql: string;
  hash: string;
}

function loadMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((filename) => {
    const path = join(MIGRATIONS_DIR, filename);
    const sql = readFileSync(path, "utf8");
    return { filename, path, sql, hash: sha256(sql) };
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const migrations = loadMigrations();
  console.log(`Found ${migrations.length} migration file(s) in ${MIGRATIONS_DIR}`);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Advisory lock: serialize concurrent migrate runs (e.g. blder + ws-gateway
    // deploys racing). Released automatically when the connection ends.
    // Lock key is an arbitrary 64-bit int picked once for this tool.
    await client.query(`SELECT pg_advisory_lock(8823427361421345)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bob_migrations (
        filename text PRIMARY KEY,
        hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ filename: string; hash: string }>(
      `SELECT filename, hash FROM bob_migrations`,
    );
    const appliedMap = new Map(applied.rows.map((r) => [r.filename, r.hash]));

    // Sanity check: already-applied files must match recorded hash.
    for (const m of migrations) {
      const recorded = appliedMap.get(m.filename);
      if (recorded && recorded !== m.hash) {
        console.error(
          `ERROR: ${m.filename} already applied but hash has changed.\n` +
            `  recorded: ${recorded}\n  current:  ${m.hash}\n` +
            `Migrations are immutable. Create a new file instead of editing this one.`,
        );
        process.exit(1);
      }
    }

    const pending = migrations.filter((m) => !appliedMap.has(m.filename));
    if (pending.length === 0) {
      console.log("No pending migrations. Schema is up to date.");
      return;
    }

    if (BOOTSTRAP) {
      console.log(`Bootstrap: marking ${pending.length} migration(s) as applied without running them:`);
      for (const m of pending) console.log(`  ✓ ${m.filename}`);
      if (DRY_RUN) {
        console.log("(dry-run, no changes written)");
        return;
      }
      await client.query("BEGIN");
      for (const m of pending) {
        await client.query(
          `INSERT INTO bob_migrations (filename, hash) VALUES ($1, $2)`,
          [m.filename, m.hash],
        );
      }
      await client.query("COMMIT");
      console.log(`Bootstrap complete.`);
      return;
    }

    console.log(`Applying ${pending.length} pending migration(s):`);
    for (const m of pending) console.log(`  → ${m.filename}`);
    if (DRY_RUN) {
      console.log("(dry-run, no changes written)");
      return;
    }

    for (const m of pending) {
      console.log(`\n==> ${m.filename}`);
      try {
        await client.query("BEGIN");
        await client.query(m.sql);
        await client.query(
          `INSERT INTO bob_migrations (filename, hash) VALUES ($1, $2)`,
          [m.filename, m.hash],
        );
        await client.query("COMMIT");
        console.log(`    ✓ applied`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`    ✗ FAILED:`, err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }

    console.log(`\nAll migrations applied.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration runner failed:", err);
  process.exit(1);
});
