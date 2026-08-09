import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../drizzle/0018_external_status_reconciliation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const rollback = readFileSync(
  fileURLToPath(
    new URL(
      "../../../drizzle/rollback/0018_external_status_reconciliation.down.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("external status reconciliation migration", () => {
  it("adds only lease and observation state to OODA-owned external links", () => {
    expect(migration).toContain('ALTER TABLE "ooda"."external_links"');
    expect(migration).toContain('ADD COLUMN "status_claimed_at"');
    expect(migration).toContain('ADD COLUMN "next_status_check_at"');
    expect(migration).toContain(
      'CREATE INDEX "external_links_status_check_idx"',
    );
    expect(migration).not.toMatch(/DROP (TABLE|SCHEMA)/);
  });

  it("has a scoped rollback for every added column and index", () => {
    for (const name of [
      "status_observed_at",
      "status_claimed_at",
      "status_claimed_by",
      "status_error",
      "next_status_check_at",
    ]) {
      expect(rollback).toContain(`DROP COLUMN IF EXISTS "${name}"`);
    }
    expect(rollback).toContain(
      'DROP INDEX IF EXISTS "ooda"."external_links_status_check_idx"',
    );
    expect(rollback).not.toMatch(/DROP (TABLE|SCHEMA)/);
  });
});
