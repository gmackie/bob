import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "./client-pglite.js";
import { makePgliteDb } from "./client-pglite.js";
import { applyMigrations, noop } from "./migrate.js";

const DRIZZLE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

let tmpDir: string;
let handle: PgliteDbHandle;

describe("OODA intake lineage migrations", () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "bob-lineage-migration-"));
    handle = await makePgliteDb({ dataDir: ":memory:", bootstrap: false });
    await handle.client.exec(`
      create table projects (
        id uuid primary key,
        name text not null
      );
      create table work_items (
        id uuid primary key,
        project_id uuid references projects(id),
        title text not null,
        status text not null,
        external_provider varchar(32),
        external_id text,
        external_url text,
        created_at timestamp not null,
        updated_at timestamptz not null
      );
      insert into projects (id, name) values
        ('11111111-1111-4111-8111-111111111111', 'Original import'),
        ('22222222-2222-4222-8222-222222222222', 'Current import');
      insert into work_items (
        id, project_id, title, status, external_provider, external_id,
        external_url, created_at, updated_at
      ) values
        (
          '33333333-3333-4333-8333-333333333333',
          '11111111-1111-4111-8111-111111111111',
          'Add a contact page', 'done', 'linear', 'linear-issue-1',
          'https://linear.example/issue/1',
          '2026-07-10T03:26:06.108Z', '2026-07-10T03:26:06.108Z'
        ),
        (
          '44444444-4444-4444-8444-444444444444',
          '22222222-2222-4222-8222-222222222222',
          'Add a contact page', 'in_progress', 'linear', 'linear-issue-1',
          'https://linear.example/issue/1',
          '2026-07-10T03:26:06.329Z', '2026-07-10T03:26:06.329Z'
        ),
        (
          '55555555-5555-4555-8555-555555555555',
          '11111111-1111-4111-8111-111111111111',
          'Draft work', 'draft', 'linear', 'linear-issue-2', null,
          '2026-07-10T04:00:00.000Z', '2026-07-10T04:00:00.000Z'
        ),
        (
          '66666666-6666-4666-8666-666666666666',
          '22222222-2222-4222-8222-222222222222',
          'Completed copy', 'done', 'linear', 'linear-issue-2', null,
          '2026-07-10T04:01:00.000Z', '2026-07-10T04:01:00.000Z'
        ),
        (
          '77777777-7777-4777-8777-777777777777',
          '11111111-1111-4111-8111-111111111111',
          'Planned work', 'planned', 'linear', 'linear-issue-3', null,
          '2026-07-10T05:00:00.000Z', '2026-07-10T05:00:00.000Z'
        ),
        (
          '88888888-8888-4888-8888-888888888888',
          '22222222-2222-4222-8222-222222222222',
          'Cancelled copy', 'cancelled', 'linear', 'linear-issue-3', null,
          '2026-07-10T05:01:00.000Z', '2026-07-10T05:01:00.000Z'
        );
    `);

    const filename = "0024z_deduplicate_external_lineage.sql";
    writeFileSync(
      join(tmpDir, filename),
      readFileSync(join(DRIZZLE_DIR, filename), "utf8"),
    );
  });

  afterEach(async () => {
    await handle.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preserves duplicate work items while assigning one canonical external lineage", async () => {
    await applyMigrations({
      client: handle.client,
      migrationsDir: tmpDir,
      log: noop,
    });

    const rows = await handle.db.execute(sql`
      select id, status, external_provider, external_id, external_url,
             source_metadata
      from work_items
      order by created_at, id
    `);
    expect(rows.rows).toHaveLength(6);
    const byId = Object.fromEntries(
      rows.rows.map((row) => [(row as { id: string }).id, row]),
    );
    expect(byId["33333333-3333-4333-8333-333333333333"]).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      status: "done",
      external_provider: null,
      external_id: null,
      external_url: null,
      source_metadata: {
        deduplicatedExternalLineage: {
          provider: "linear",
          id: "linear-issue-1",
          url: "https://linear.example/issue/1",
        },
      },
    });
    expect(byId["44444444-4444-4444-8444-444444444444"]).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      status: "in_progress",
      external_provider: "linear",
      external_id: "linear-issue-1",
    });
    expect(byId["55555555-5555-4555-8555-555555555555"]).toMatchObject({
      status: "draft",
      external_provider: "linear",
      external_id: "linear-issue-2",
    });
    expect(byId["66666666-6666-4666-8666-666666666666"]).toMatchObject({
      status: "done",
      external_provider: null,
      external_id: null,
    });
    expect(byId["77777777-7777-4777-8777-777777777777"]).toMatchObject({
      status: "planned",
      external_provider: "linear",
      external_id: "linear-issue-3",
    });
    expect(byId["88888888-8888-4888-8888-888888888888"]).toMatchObject({
      status: "cancelled",
      external_provider: null,
      external_id: null,
    });

    await expect(
      handle.db.execute(sql`
        insert into work_items (
          id, title, status, external_provider, external_id, created_at, updated_at
        ) values (
          '99999999-9999-4999-8999-999999999999', 'Duplicate', 'todo',
          'linear', 'linear-issue-1', now(), now()
        )
      `),
    ).rejects.toThrow(/unique|duplicate/i);

    const intakeFilename = "0025_ooda_intake_lineage.sql";
    writeFileSync(
      join(tmpDir, intakeFilename),
      readFileSync(join(DRIZZLE_DIR, intakeFilename), "utf8"),
    );
    await applyMigrations({
      client: handle.client,
      migrationsDir: tmpDir,
      log: noop,
    });
    const applied = await handle.db.execute(
      sql`select filename from bob_migrations order by filename`,
    );
    expect(applied.rows).toEqual([
      { filename: "0024z_deduplicate_external_lineage.sql" },
      { filename: "0025_ooda_intake_lineage.sql" },
    ]);
  });
});
