import { describe, expect, it } from "vitest";

import type { ProjectWorkItem } from "../project-detail-utils";
import { getRequirementTargets } from "../project-detail-utils";

function item(overrides: Partial<ProjectWorkItem>): ProjectWorkItem {
  return {
    id: "item-1",
    identifier: "APP-1",
    title: "Item",
    description: null,
    status: "todo",
    kind: "task",
    priority: "no_priority",
    parentId: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("getRequirementTargets", () => {
  it("returns top-level epics and issues before child scope owners", () => {
    const targets = getRequirementTargets([
      item({ id: "task", identifier: "APP-3", kind: "task" }),
      item({
        id: "child-issue",
        identifier: "APP-4",
        kind: "issue",
        parentId: "epic",
      }),
      item({ id: "issue", identifier: "APP-2", kind: "issue" }),
      item({ id: "epic", identifier: "APP-1", kind: "epic" }),
    ]);

    expect(targets.map((target) => target.id)).toEqual([
      "epic",
      "issue",
      "child-issue",
    ]);
  });
});
