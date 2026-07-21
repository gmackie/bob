import { describe, expect, it } from "vitest";
import { WorkItemsRpc } from "../groups/work-items.js";

describe("WorkItemsRpc — 7B-4C Task 3", () => {
  it("has 33 procedures after Task 3 + markAllAsRead", () => {
    expect(WorkItemsRpc.requests.size).toBe(33);
  });

  it("contains requirement procedures", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.requirement.list");
    expect(names).toContain("workItem.requirement.create");
    expect(names).toContain("workItem.requirement.update");
    expect(names).toContain("workItem.requirement.delete");
    expect(names).toContain("workItem.requirement.linkToTask");
  });

  it("contains link procedures", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.link.list");
    expect(names).toContain("workItem.link.byId");
    expect(names).toContain("workItem.link.byWorktree");
    expect(names).toContain("workItem.link.create");
    expect(names).toContain("workItem.link.update");
    expect(names).toContain("workItem.link.delete");
    expect(names).toContain("workItem.link.linkToPlanningTask");
    expect(names).toContain("workItem.link.linkToGitHubPR");
  });
});
