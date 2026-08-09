import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function migration(path: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../drizzle/${path}`, import.meta.url)),
    "utf8",
  );
}

describe("subscription runtime migration", () => {
  it("adds durable attempt fencing and provider-native session identity", () => {
    const up = migration("0014_puzzling_lady_bullseye.sql");
    expect(up).toContain('ADD COLUMN "billing_policy"');
    expect(up).toContain('ADD COLUMN "native_session_id"');
    expect(up).toContain('ADD COLUMN "native_turn_id"');
    expect(up).toContain('ADD COLUMN "attempt"');
    expect(up).toContain('ADD COLUMN "lease_token"');
    expect(up).toContain('ADD COLUMN "lease_duration_seconds"');
  });

  it("has a complete rollback", () => {
    const down = migration("rollback/0014_puzzling_lady_bullseye.down.sql");
    for (const column of [
      "billing_policy",
      "auth_mode",
      "native_session_id",
      "native_turn_id",
      "attempt",
      "lease_token",
      "lease_duration_seconds",
    ]) {
      expect(down).toContain(`DROP COLUMN IF EXISTS "${column}"`);
    }
  });
});
