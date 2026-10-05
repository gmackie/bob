import { describe, expect, it } from "vitest";

import { validateProductionMigrationLedger } from "./production-migrate";

const historical = Array.from({ length: 43 }, (_, index) => ({
  filename: `${String(index).padStart(4, "0")}_historical.sql`,
  hash: `hash-${index}`,
}));
const approved = {
  filename: "0036_canonical_auth_foreign_keys.sql",
  hash: "approved-hash",
};
const files = [...historical, approved];

describe("production migration deployment guard", () => {
  it("accepts only the approved pending migration and allows historical extra ledger entries", () => {
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
        ...historical.slice(1),
        { filename: "0000_historical.sql", hash: "changed" },
      ]),
    ).toThrow("mismatch");
    expect(() =>
      validateProductionMigrationLedger(
        [...files, { filename: "0037_unreviewed.sql", hash: "new" }],
        historical,
      ),
    ).toThrow("roster");
  });
});
