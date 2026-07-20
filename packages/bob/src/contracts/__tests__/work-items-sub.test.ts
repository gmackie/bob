import { describe, expect, it } from "vitest";
import { WorkItemsRpc } from "../groups/work-items.js";

describe("WorkItemsRpc — 7B-4C Task 2", () => {
  it("has at least 18 procedures (Task 2 baseline)", () => {
    expect(WorkItemsRpc.requests.size).toBeGreaterThanOrEqual(18);
  });

  it("contains artifact procedures", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.artifact.create");
    expect(names).toContain("workItem.artifact.listCurrent");
    expect(names).toContain("workItem.artifact.listChildGroups");
  });

  it("contains activity procedures", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.activity.list");
    expect(names).toContain("workItem.activity.listRecent");
  });

  it("contains notification procedures", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.notification.list");
    expect(names).toContain("workItem.notification.create");
    expect(names).toContain("workItem.notification.markAsRead");
    expect(names).toContain("workItem.notification.markAllAsRead");
    expect(names).toContain("workItem.notification.registerPushToken");
  });

  it("contains taskRun procedures", () => {
    const names = [...WorkItemsRpc.requests.keys()];
    expect(names).toContain("workItem.taskRun.listByWorkItem");
    expect(names).toContain("workItem.taskRun.execute");
    expect(names).toContain("workItem.taskRun.listLifecycleEvents");
  });
});
