import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../drizzle/0019_standalone_vault_pgvector.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const rollback = readFileSync(
  fileURLToPath(
    new URL(
      "../../../drizzle/rollback/0019_standalone_vault_pgvector.down.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("standalone vault pgvector migration", () => {
  it("adds a native vector projection and resumable provenance ledger", () => {
    expect(migration).toContain('"embedding" vector(768) NOT NULL');
    expect(migration).toContain('"source_embedding_vec_hnsw_idx"');
    expect(migration).toContain('CREATE TABLE "ooda"."migration_runs"');
    expect(migration).toContain('CREATE TABLE "ooda"."migration_records"');
    expect(migration).toContain(
      `ALTER TYPE "research_vault"."source_kind" ADD VALUE IF NOT EXISTS 'paper-s2'`,
    );
    expect(migration).toContain(
      `ALTER TYPE "research_vault"."source_kind" ADD VALUE IF NOT EXISTS 'paper-openalex'`,
    );
    expect(migration).not.toMatch(/ALTER TABLE .*"embeddings"/);
    expect(migration).not.toMatch(/DROP (TABLE|SCHEMA)/);
  });

  it("rolls back only the additive projection and ledger", () => {
    for (const table of [
      '"personal_vault"."source_embedding"',
      '"research_vault"."source_embedding"',
      '"ooda"."migration_records"',
      '"ooda"."migration_runs"',
    ]) {
      expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`);
    }
    expect(rollback).not.toContain(
      'DROP TABLE IF EXISTS "research_vault"."sources"',
    );
    expect(rollback).not.toContain(
      'DROP TABLE IF EXISTS "research_vault"."embeddings"',
    );
  });
});
