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

describe("Hermes usage event migration", () => {
  let handle: PgliteDbHandle;
  let migrationsDir: string;

  beforeEach(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:", bootstrap: false });
    migrationsDir = mkdtempSync(join(tmpdir(), "bob-hermes-usage-migration-"));
    const filename = "0029_hermes_usage_events.sql";
    writeFileSync(
      join(migrationsDir, filename),
      readFileSync(join(DRIZZLE_DIR, filename), "utf8"),
    );
  });

  afterEach(async () => {
    await handle.close();
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it("stores replay-safe categorical evidence without a content column", async () => {
    await applyMigrations({ client: handle.client, migrationsDir, log: noop });
    const columns = await handle.db.execute(sql`
      select column_name
      from information_schema.columns
      where table_name = 'hermes_usage_events'
      order by column_name
    `);

    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("request_id_digest");
    expect(names).toContain("actor_user_id_digest");
    expect(names).not.toContain("content");
    expect(names).not.toContain("request_id");
    expect(names).not.toContain("path");

    await expect(
      handle.db.execute(sql`
        insert into hermes_usage_events (
          record_id, request_id_digest, actor_user_id_digest, intent, channel,
          owner, risk_class, outcome, duration_bucket, evidence, observed_at
        ) values (
          ${`sha256:${"a".repeat(64)}`}, ${`sha256:${"b".repeat(64)}`},
          ${`sha256:${"c".repeat(64)}`}, 'made_up_intent', 'telegram', 'bob',
          'R0', 'success', '<1s', 'complete', now()
        )
      `),
    ).rejects.toThrow();
  });
});
