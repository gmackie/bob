import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("runLifecycleEvents schema", () => {
  it("has runLifecycleEvents table in schema", () => {
    // Table moved from @bob/db/schema to @bob/agents/schema in Phase 7B-2 Task 13.
    const source = readFileSync(
      path.resolve(__dirname, "../../../../../src/agents/src/schema.ts"),
      "utf8",
    );
    expect(source).toContain("runLifecycleEvents");
    expect(source).toContain("run_lifecycle_events");
  });
});
