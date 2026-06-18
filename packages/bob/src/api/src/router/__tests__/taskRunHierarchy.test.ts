import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("taskRuns run hierarchy schema", () => {
  it("has parentTaskRunId and runPhase fields in schema", () => {
    // taskRuns moved to @bob/work-items/schema in Phase 7B-2 Task 12.
    const source = readFileSync(
      path.resolve(__dirname, "../../../../../src/work-items/src/schema.ts"),
      "utf8",
    );
    expect(source).toContain("parentTaskRunId");
    expect(source).toContain("runPhase");
  });
});
