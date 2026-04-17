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
    // Raw empty PGlite: this suite is about `applyMigrations` itself; the
    // auto-bootstrap path in `makePgliteDb` would pre-populate `bob_migrations`
    // with real drizzle filenames and invalidate the assertions below.
    handle = await makePgliteDb({ dataDir: ":memory:", bootstrap: false });
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
      sql`select filename from bob_migrations order by filename`,
    );
    expect(applied.rows.length).toBeGreaterThan(0);
    // Sanity: the first committed migration filename starts with "0001"
    expect(applied.rows[0]).toMatchObject({
      filename: expect.stringContaining("0001"),
    });
  });

  it("throws when an applied migration's SQL is edited after the fact", async () => {
    await applyMigrations({
      client: handle.client,
      migrationsDir: tmpDir,
      log: () => {},
    });

    // Mutate an already-applied file on disk, then re-run.
    writeFileSync(
      join(tmpDir, FIXTURE_MIGRATIONS[0]!.filename),
      `-- tampered\n${FIXTURE_MIGRATIONS[0]!.sql}`,
    );

    await expect(
      applyMigrations({
        client: handle.client,
        migrationsDir: tmpDir,
        log: () => {},
      }),
    ).rejects.toThrow(/hash has changed|immutable/i);
  });

  it("rolls back the transaction and does not record tracking row on failure", async () => {
    // Add a third migration that is deliberately broken SQL.
    const brokenFile = "0003_broken.sql";
    writeFileSync(
      join(tmpDir, brokenFile),
      `CREATE TABLE "bar" ("id" serial PRIMARY KEY); -- already exists: will fail`,
    );

    await expect(
      applyMigrations({
        client: handle.client,
        migrationsDir: tmpDir,
        log: () => {},
      }),
    ).rejects.toThrow();

    // bar table was already created by 0002 on first two migrations (so those
    // are still applied). 0003 must NOT be recorded.
    const applied = await handle.db.execute(
      sql`select filename from bob_migrations order by filename`,
    );
    const names = applied.rows.map((r) => (r as { filename: string }).filename);
    expect(names).toEqual(["0001_initial.sql", "0002_add_bar.sql"]);
    expect(names).not.toContain(brokenFile);
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
