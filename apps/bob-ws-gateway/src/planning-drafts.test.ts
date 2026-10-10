import { describe, expect, it } from "vitest";

import {
  missingDraftDependencies,
  normalizePlanningTasks,
  planDraftSync,
  type ExistingPlanDraft,
} from "./planning-drafts.js";

function draft(overrides: Partial<ExistingPlanDraft> & Pick<ExistingPlanDraft, "id" | "title" | "status">): ExistingPlanDraft {
  return {
    description: null,
    kind: "task",
    priority: "no_priority",
    sortOrder: 0,
    ...overrides,
  };
}

describe("planning draft sync", () => {
  it("normalizes the event payload and drops the prompt example", () => {
    const tasks = normalizePlanningTasks({
      tasks: [
        { title: "Name the real task", description: "placeholder" },
        {
          title: "  Ship the panel ",
          description: "Visible on iPhone.",
          kind: "epic",
          priority: "high",
          dependsOn: ["Ship the panel", "Missing"],
        },
      ],
    });
    expect(tasks).toEqual([
      {
        key: "ship the panel",
        title: "Ship the panel",
        description: "Visible on iPhone.",
        kind: "epic",
        priority: "high",
        sortOrder: 0,
        dependsOn: ["missing"],
      },
    ]);
    expect(planDraftSync([], tasks).dependencies).toEqual([]);
  });

  it("inserts new drafts and links them by title", () => {
    const tasks = normalizePlanningTasks({
      tasks: [
        { title: "Write the screen", description: "Phone and iPad." },
        { title: "Watch the run", dependsOn: ["Write the screen"] },
      ],
    });
    const plan = planDraftSync([], tasks);
    expect(plan.inserts.map((task) => task.title)).toEqual(["Write the screen", "Watch the run"]);
    expect(plan.updates).toEqual([]);
    expect(plan.dependencies).toEqual([
      { fromKey: "watch the run", toKey: "write the screen" },
    ]);
    expect(
      missingDraftDependencies(
        [],
        [
          { key: "write the screen", id: "draft-1" },
          { key: "watch the run", id: "draft-2" },
        ],
        plan.dependencies,
        [],
      ),
    ).toEqual([{ draftId: "draft-2", dependsOnDraftId: "draft-1" }]);
  });

  it("updates a matching draft and leaves a committed task alone", () => {
    const tasks = normalizePlanningTasks({
      tasks: [
        { title: "Write the screen", description: "Updated copy." },
        { title: "Already shipped", description: "Do not recreate." },
      ],
    });
    const plan = planDraftSync(
      [
        draft({ id: "draft-1", title: "Write the screen", status: "draft", sortOrder: 0 }),
        draft({ id: "done-1", title: "Already shipped", status: "committed" }),
      ],
      tasks,
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([
      {
        id: "draft-1",
        description: "Updated copy.",
        kind: "task",
        priority: "no_priority",
        sortOrder: 0,
      },
    ]);
  });

  it("does not resurrect a discarded title or repeat an existing link", () => {
    const tasks = normalizePlanningTasks({
      tasks: [
        { title: "Keep me", dependsOn: ["Shipped"] },
        { title: "Gone" },
      ],
    });
    const plan = planDraftSync(
      [
        draft({ id: "draft-1", title: "Keep me", status: "draft" }),
        draft({ id: "gone-1", title: "Gone", status: "discarded" }),
        draft({ id: "done-1", title: "Shipped", status: "committed" }),
      ],
      tasks,
    );
    expect(plan.inserts).toEqual([]);
    expect(plan.dependencies).toEqual([{ fromKey: "keep me", toKey: "shipped" }]);
    expect(
      missingDraftDependencies(
        [
          draft({ id: "draft-1", title: "Keep me", status: "draft" }),
          draft({ id: "done-1", title: "Shipped", status: "committed" }),
        ],
        [],
        plan.dependencies,
        [{ draftId: "draft-1", dependsOnDraftId: "done-1" }],
      ),
    ).toEqual([]);
  });
});
