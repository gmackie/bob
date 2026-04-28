import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { applyTestMigrations, sortMigrationFiles } from "./helpers";

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
