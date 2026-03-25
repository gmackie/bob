import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("runLifecycleEvents schema", () => {
  it("has runLifecycleEvents table in schema", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../../packages/db/src/schema.ts"),
      "utf8",
    );
    expect(source).toContain("runLifecycleEvents");
    expect(source).toContain("run_lifecycle_events");
  });
});
