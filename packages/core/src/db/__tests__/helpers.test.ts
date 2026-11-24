import { describe, it, expect, onTestFinished } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { applyTestMigrations, createTestDb, sortMigrationFiles } from "./helpers";

describe("createTestDb", () => {
  it("keeps migrations and writes local to each fixture", async () => {
    const migrated = await createTestDb();
    onTestFinished(migrated.teardown);
    await migrated.pglite.exec("INSERT INTO tenants (name, slug) VALUES ('First', 'first')");

    const empty = await createTestDb({ applyMigrations: false });
    onTestFinished(empty.teardown);
    const tables = await empty.pglite.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    expect(tables.rows).toEqual([]);

    await applyTestMigrations(empty.pglite);
    expect((await empty.pglite.query("SELECT slug FROM tenants")).rows).toEqual([]);
    expect((await migrated.pglite.query("SELECT slug FROM tenants")).rows).toEqual([{ slug: "first" }]);
  });
});

describe("applyTestMigrations empty-dir guard", () => {
  it("throws when the migrations directory contains no .sql files", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmacko-empty-migrations-"));
    const pglite = new PGlite();
    try {
      await expect(applyTestMigrations(pglite, { migrationsDir: emptyDir })).rejects.toThrow(
        new RegExp(`no migrations.*${emptyDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${emptyDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*no migrations`, "i"),
      );
    } finally {
      await pglite.close();
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("sortMigrationFiles", () => {
  it("sorts by leading numeric prefix (not lexicographically)", () => {
    // Note: real drizzle files are 4-digit-padded so lex == numeric. We use
    // unpadded numbers here to assert the guard's intent: numeric ordering.
    const input = ["100_b.sql", "10_a.sql", "2_c.sql", "9_d.sql"];
    const expected = ["2_c.sql", "9_d.sql", "10_a.sql", "100_b.sql"];
    expect(sortMigrationFiles(input)).toEqual(expected);
  });
});
