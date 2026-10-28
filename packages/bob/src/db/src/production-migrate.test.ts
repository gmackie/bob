import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateProductionMigrationLedger } from "./production-migrate";

const migrations = new URL("../drizzle/", import.meta.url);
const files = readdirSync(migrations)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((filename) => ({
    filename,
    hash: createHash("sha256")
      .update(readFileSync(new URL(filename, migrations)))
      .digest("hex"),
  }));
const historical = files.filter(
  (entry) =>
    ![
      "0034_plan_draft_kanbanger_issue.sql",
      "0036_canonical_auth_foreign_keys.sql",
      "0037_mcp_oauth.sql",
    ].includes(entry.filename),
);

describe("production migration deployment guard", () => {
  it("accepts only the approved pending migrations and allows historical extra ledger entries", () => {
    expect(() =>
      validateProductionMigrationLedger(files, [
        ...historical,
        { filename: "historical-extra.sql", hash: "extra" },
      ]),
    ).not.toThrow();
    expect(() => validateProductionMigrationLedger(files, files)).not.toThrow();
  });
  it("rejects missing historical migrations, modified hashes, and unreviewed new migrations", () => {
    expect(() =>
      validateProductionMigrationLedger(files, historical.slice(1)),
    ).toThrow("missing");
    expect(() =>
      validateProductionMigrationLedger(files, [
        ...historical.map((entry, index) =>
          index === 0 ? { ...entry, hash: "changed" } : entry,
        ),
      ]),
    ).toThrow("mismatch");
    expect(() =>
      validateProductionMigrationLedger(
        [...files, { filename: "0038_unreviewed.sql", hash: "new" }],
        historical,
      ),
    ).toThrow("roster");
  });
});
