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

describe("Hermes approval consumption migration", () => {
  let handle: PgliteDbHandle;
  let migrationsDir: string;

  beforeEach(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:", bootstrap: false });
    migrationsDir = mkdtempSync(
      join(tmpdir(), "bob-hermes-approval-migration-"),
    );
    const filename = "0028_hermes_approval_consumptions.sql";
    writeFileSync(
      join(migrationsDir, filename),
      readFileSync(join(DRIZZLE_DIR, filename), "utf8"),
    );
  });

  afterEach(async () => {
    await handle.close();
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it("adds durable uniqueness boundaries for approval, execution, and idempotency", async () => {
    await applyMigrations({
      client: handle.client,
      migrationsDir,
      log: noop,
    });

    await handle.db.execute(sql`
      insert into hermes_approval_consumptions (
        approval_id, proposal_id, owner, scope_digest, execution_id,
        idempotency_key, consumed_at, expires_at
      ) values (
        'approval-1', 'proposal-1', 'bob', ${`sha256:${"a".repeat(64)}`},
        'execution-1', 'hermes:work:1', now(), now() + interval '15 minutes'
      )
    `);

    await expect(
      handle.db.execute(sql`
      insert into hermes_approval_consumptions (
        approval_id, proposal_id, owner, scope_digest, execution_id,
        idempotency_key, consumed_at, expires_at
      ) values (
        'approval-2', 'proposal-2', 'bob', ${`sha256:${"b".repeat(64)}`},
        'execution-1', 'hermes:work:2', now(), now() + interval '15 minutes'
      )
    `),
    ).rejects.toThrow();

    const rows = await handle.db.execute(sql`
      select approval_id, execution_id
      from hermes_approval_consumptions
    `);
    expect(rows.rows).toEqual([
      {
        approval_id: "approval-1",
        execution_id: "execution-1",
      },
    ]);
  });
});
