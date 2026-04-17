import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { makePgliteDb, type PgliteDbHandle } from "./client-pglite.js";
import { applyMigrations } from "./migrate.js";

/**
 * Cross-driver smoke test for {@link applyMigrations}.
 *
 * We drive the runner from a temp directory of representative SQL fixtures
 * rather than `packages/db/drizzle/` — the real drizzle migrations were
 * authored as incremental patches on top of a pre-existing ngi-kanbanger /
 * better-auth schema and don't cleanly bootstrap an empty database. That's
 * Task 7's concern; here we only prove `applyMigrations({ client })` works
 * against a PGlite client, tracks in `bob_migrations`, and is idempotent.
 */

let tmpDir: string;
let handle: PgliteDbHandle;

const FIXTURE_MIGRATIONS: Array<{ filename: string; sql: string }> = [
  {
    filename: "0001_initial.sql",
    sql: `
      CREATE TABLE "foo" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL
      );
    `,
  },
  {
    filename: "0002_add_bar.sql",
    sql: `
      CREATE TABLE "bar" (
        "id" serial PRIMARY KEY,
        "foo_id" integer REFERENCES "foo"("id")
      );
    `,
  },
];

describe("applyMigrations against PGlite", () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "bob-migrate-pglite-"));
    for (const m of FIXTURE_MIGRATIONS) {
      writeFileSync(join(tmpDir, m.filename), m.sql);
    }
    handle = await makePgliteDb({ dataDir: ":memory:" });
  });

  afterEach(async () => {
    await handle.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies all forward migrations and records them in bob_migrations", async () => {
    await applyMigrations({
      client: handle.client,
      migrationsDir: tmpDir,
      log: () => {},
    });

    const applied = await handle.db.execute(
      sql`select filename from bob_migrations order by applied_at`,
    );
    expect(applied.rows.length).toBeGreaterThan(0);
    // Sanity: the first committed migration filename starts with "0001"
    expect(applied.rows[0]).toMatchObject({
      filename: expect.stringContaining("0001"),
    });
  });

  it("is idempotent when run twice", async () => {
    await applyMigrations({
      client: handle.client,
      migrationsDir: tmpDir,
      log: () => {},
    });
    const firstCount = (
      await handle.db.execute(
        sql`select count(*)::int as c from bob_migrations`,
      )
    ).rows[0] as { c: number };

    await applyMigrations({
      client: handle.client,
      migrationsDir: tmpDir,
      log: () => {},
    });
    const secondCount = (
      await handle.db.execute(
        sql`select count(*)::int as c from bob_migrations`,
      )
    ).rows[0] as { c: number };

    expect(secondCount.c).toEqual(firstCount.c);
    expect(secondCount.c).toEqual(FIXTURE_MIGRATIONS.length);
  });
});
