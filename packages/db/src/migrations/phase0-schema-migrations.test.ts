import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

async function loadMigrationSql() {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const contents = await Promise.all(
    files.map(async (file) =>
      readFile(path.join(migrationsDir, file), "utf8"),
    ),
  );

  return contents.join("\n");
}

describe("phase 0 schema migrations", () => {
  it("commits SQL for tenants, workspace tenant fields, and agent runs", async () => {
    const sql = await loadMigrationSql();

    expect(sql).toContain('create table "tenants"');
    expect(sql).toContain('create table "tenant_members"');
    expect(sql).toContain('create table "agent_runs"');
    expect(sql).toContain('create table "run_artifacts"');
    expect(sql).toContain('add column "tenant_id"');
    expect(sql).toContain('add column "machine_id"');
    expect(sql).toContain('add column "last_heartbeat"');
    expect(sql).toContain('add column "agent_configs"');
  });
});
