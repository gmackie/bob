import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../drizzle/0006_clean_viper.sql", import.meta.url),
);
const rollbackPath = fileURLToPath(
  new URL(
    "../../../drizzle/rollback/0006_clean_viper.down.sql",
    import.meta.url,
  ),
);

describe("OODA personal OS migration", () => {
  it("is additive and scoped to the ooda schema", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain('CREATE SCHEMA "ooda"');
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(sql).not.toContain('CREATE TABLE "note_index"');
    expect(sql).not.toContain('ALTER TABLE "research_thread"');
    expect(sql).not.toContain('CREATE TABLE "personal_vault"');
    expect(sql).not.toContain('CREATE TABLE "research_vault"');

    const tableTargets = [...sql.matchAll(/CREATE TABLE\s+([^\s(]+)/g)].map(
      (match) => match[1],
    );
    expect(tableTargets.length).toBeGreaterThan(0);
    expect(tableTargets.every((target) => target?.startsWith('"ooda".'))).toBe(
      true,
    );
  });

  it("has an explicit pre-cutover rollback that only removes the new schema", () => {
    const sql = readFileSync(rollbackPath, "utf8").trim();

    expect(sql).toBe('DROP SCHEMA IF EXISTS "ooda" CASCADE;');
  });
});
