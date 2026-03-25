import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("taskRuns run hierarchy schema", () => {
  it("has parentTaskRunId and runPhase fields in schema", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../../packages/db/src/schema.ts"),
      "utf8",
    );
    expect(source).toContain("parentTaskRunId");
    expect(source).toContain("runPhase");
  });
});
