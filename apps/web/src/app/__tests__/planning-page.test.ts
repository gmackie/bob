import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("~/components/projects/project-card", () => ({
  ProjectCard: (props: { name: string }) => `<div>${props.name}</div>`,
}));

vi.mock("~/components/projects/create-project-button", () => ({
  CreateProjectButton: () => null,
}));

vi.mock("~/components/work-items/create-work-item-button", () => ({
  CreateWorkItemButton: () => null,
}));

vi.mock("~/components/planning/start-planning-button", () => ({
  StartPlanningButton: () => null,
}));

vi.mock("~/components/work-items/board-filter-bar", () => ({
  FilterableBoard: () => "<div>Work board</div>",
}));

vi.mock("~/components/planning/active-dispatch-bar", () => ({
  ActiveDispatchBar: () => null,
}));

vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: vi.fn(async () => ({
    workspace: {
      list: vi.fn(async () => [
        {
          workspace: {
            id: "workspace-1",
            name: "Builder",
          },
        },
      ]),
    },
    project: {
      list: vi.fn(async () => [
        {
          project: {
            id: "project-1",
            workspaceId: "workspace-1",
            key: "BUILD",
            name: "Builder",
            status: "active",
            description: "Merged planning surface",
            color: "#3355aa",
          },
          counts: {
            issues: 2,
            tasks: 1,
            epics: 1,
            active: 1,
          },
        },
      ]),
    },
    workItem: {
      list: vi.fn(async () => [
        {
          id: "work-item-1",
          identifier: "BUILD-1",
          title: "Tighten planning copy",
          status: "todo",
          kind: "task",
        },
      ]),
    },
  })),
}));

describe("planning page", () => {
  it("frames execution as a task-scoped workspace", async () => {
    const module = await import("../(dashboard)/planning/page");
    const markup = renderToStaticMarkup(await module.default());

    expect(markup).toContain(
      "scan active work before opening a task&#x27;s execution workspace.",
    );
    expect(markup).not.toContain("jumping into a task workspace");
  });
});
