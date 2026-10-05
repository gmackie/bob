#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import type { MigrationClient } from "./migrate";
import { applyMigrations } from "./migrate";

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);
const approvedMigration = "0036_canonical_auth_foreign_keys.sql";
interface MigrationHash {
  filename: string;
  hash: string;
}

export function validateProductionMigrationLedger(
  files: MigrationHash[],
  ledger: MigrationHash[],
): void {
  const applied = new Map(ledger.map((entry) => [entry.filename, entry.hash]));
  if (files.length !== 44 || files.at(-1)?.filename !== approvedMigration) {
    throw new Error(
      "Production migration roster changed; review the deployment migration guard",
    );
  }
  for (const file of files) {
    const recorded = applied.get(file.filename);
    if (file.filename !== approvedMigration && recorded === undefined) {
      throw new Error(
        `Historical production migration is missing: ${file.filename}`,
      );
    }
    if (recorded !== undefined && recorded !== file.hash) {
      throw new Error(`Production migration hash mismatch: ${file.filename}`);
    }
  }
}

export async function applyProductionMigrations(
  client: MigrationClient,
): Promise<void> {
  // Use the same session lock as the ordinary CLI, including during validation.
  await client.query("SET lock_timeout = '15s'");
  await client.query("SET statement_timeout = '120s'");
  await client.query("SELECT pg_advisory_lock(8823427361421345)");
  const identity = await client.query<{ database: string; role: string }>(
    "SELECT current_database() AS database, current_user AS role",
  );
  if (
    identity.rows[0]?.database !== "bob" ||
    identity.rows[0].role !== "bob"
  ) {
    throw new Error(
      "Production migration requires the bob database and bob role",
    );
  }
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((filename) => ({
      filename,
      hash: createHash("sha256")
        .update(readFileSync(join(migrationsDir, filename)))
        .digest("hex"),
    }));
  const ledger = await client.query<MigrationHash>(
    "SELECT filename, hash FROM public.bob_migrations",
  );
  validateProductionMigrationLedger(files, ledger.rows);
  const schema = await client.query<{
    canonical: string | null;
    legacy: string | null;
    legacy_fks: number;
  }>(`
    SELECT to_regclass('public.users')::text AS canonical,
           to_regclass('public."user"')::text AS legacy,
           (SELECT count(*)::integer FROM pg_constraint
            WHERE contype='f' AND confrelid=to_regclass('public."user"')) AS legacy_fks
  `);
  const state = schema.rows[0];
  if (
    !state?.canonical ||
    !state.legacy ||
    ![0, 30].includes(state.legacy_fks)
  ) {
    throw new Error(
      "Production auth schema differs from the reviewed migration coverage",
    );
  }
  const conflicts = await client.query<{ count: number }>(`
    SELECT count(*)::integer AS count FROM public."user" legacy
    JOIN public.users canonical ON canonical.id = legacy.id OR canonical.email = legacy.email
    WHERE canonical.id <> legacy.id OR canonical.email IS DISTINCT FROM legacy.email
  `);
  if (conflicts.rows[0]?.count !== 0) {
    throw new Error(
      "Canonical auth identities differ from existing legacy accounts",
    );
  }
  await applyMigrations({ client, migrationsDir });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "DATABASE_URL is required for guarded production migration",
    );
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    await applyProductionMigrations(client);
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    // Driver errors can include connection details; retain fail-closed behavior
    // without leaking the production URL to deployment logs.
    console.error(
      "Guarded production migration failed; worker upload must stop",
    );
    process.exitCode = 1;
  });
}
