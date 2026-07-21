import { describe, expect, it } from "vitest";
import { WorkItemsRpc } from "../groups/work-items.js";

describe("WorkItemsRpc — 7B-4C Task 1", () => {
  it("has at least 18 procedures (Task 1 + Task 2 baseline)", () => {
    expect(WorkItemsRpc.requests.size).toBeGreaterThanOrEqual(18);
  });

  it("contains expected procedure names", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.list");
    expect(names).toContain("workItem.statusCounts");
    expect(names).toContain("workItem.get");
    expect(names).toContain("workItem.update");
    expect(names).toContain("workItem.promoteToTask");
    expect(names).toContain("workItem.comment.list");
    expect(names).toContain("workItem.comment.create");
  });
});
