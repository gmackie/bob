import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runMigrations } from "../migrate";

describe("@gmacko/db runMigrations", () => {
  it("is idempotent when re-run against the same persistent PGlite dir", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmacko-migrate-idem-"));
    try {
      // First run: fresh dir — applies all migrations.
      const first = new PGlite(tmpDir);
      await runMigrations(first);
      await first.close();

      // Second run: reopen the same dir. The previous code re-executed every
      // statement and would throw "relation already exists". A drizzle-backed
      // migrator tracks applied migrations via `__drizzle_migrations` and
      // skips ones already applied, so this must resolve without throwing.
      const second = new PGlite(tmpDir);
      await expect(runMigrations(second)).resolves.not.toThrow();
      await second.close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
