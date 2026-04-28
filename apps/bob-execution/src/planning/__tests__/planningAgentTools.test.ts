import { describe, expect, it } from "vitest";

import {
  buildPlanningPrompt,
  mapPlanningToolCall,
  type PlanningContext,
} from "../planningAgentTools";

const ctx: PlanningContext = {
  workspaceId: "ws-001",
  projectId: "proj-001",
  projectName: "Acme App",
  sessionId: "sess-001",
};

const reactCtx: PlanningContext = {
  ...ctx,
  reactFrontend: true,
};

const launchContext: PlanningContext = {
  ...reactCtx,
  launchContext: {
    intent: "breakdown",
    notes:
      "Turn the parent scope into executable child tasks and keep requirement ownership explicit.",
    workItem: {
      id: "work-item-1",
      identifier: "EPIC-42",
      title: "Improve launch workflow",
      kind: "epic",
    },
    selectedRepoSources: [
      {
        id: "repo-readme",
        label: "Project overview",
        path: "README.md",
        detail: "Baseline product overview and setup instructions.",
      },
      {
        id: "repo-plans",
        label: "Planning docs",
        path: "docs/ai",
        detail: "Existing implementation plans and design notes.",
      },
    ],
    attachedFiles: [
      {
        name: "launch-brief.md",
        sizeLabel: "12 KB",
        content:
          "# Launch brief\n\nThe workflow modal should pass its selected context into planning startup.",
      },
    ],
  },
};

describe("buildPlanningPrompt", () => {
  it("returns a string containing the workspace ID", () => {
    const prompt = buildPlanningPrompt(ctx);
    expect(prompt).toContain("ws-001");
  });

  it("returns a string containing the project name", () => {
    const prompt = buildPlanningPrompt(ctx);
    expect(prompt).toContain("Acme App");
  });

  it("returns a string containing the session ID", () => {
    const prompt = buildPlanningPrompt(ctx);
    expect(prompt).toContain("sess-001");
  });

  it("returns a string containing tool descriptions", () => {
    const prompt = buildPlanningPrompt(ctx);
    expect(prompt).toContain("create_draft_task");
    expect(prompt).toContain("update_draft_task");
    expect(prompt).toContain("remove_draft_task");
    expect(prompt).toContain("set_dependency");
    expect(prompt).toContain("list_drafts");
  });

  it("does not include Storybook workflow guidance when the project has no React frontend", () => {
    const prompt = buildPlanningPrompt(ctx);
    expect(prompt).not.toContain("Storybook Development Workflow");
    expect(prompt).not.toContain("Required States");
  });

  it("includes generic Bob work-item shaping and breakdown guidance", () => {
    const prompt = buildPlanningPrompt(ctx);
    expect(prompt).toContain("Work Item Shaping Workflow");
    expect(prompt).toContain("rough idea");
    expect(prompt).toContain("epic or issue");
    expect(prompt).toContain("business requirements document");
    expect(prompt).toContain("one question at a time");
    expect(prompt).toContain("Requirements and Task Breakdown");
    expect(prompt).toContain("parent issue or epic");
    expect(prompt).toContain("linkedTaskId");
    expect(prompt).toContain("shape -> plan -> execute -> review -> ship");
  });

  it("includes Storybook workflow guidance for projects with a React frontend", () => {
    const prompt = buildPlanningPrompt(reactCtx);
    expect(prompt).toContain("Storybook Development Workflow");
    expect(prompt).toContain("Required States");
    expect(prompt).toContain("Prompt Payload");
    expect(prompt).toContain("Generate component, stories, and fixtures together");
  });

  it("includes explicit launch context when a workflow modal starts the planning session", () => {
    const prompt = buildPlanningPrompt(launchContext);

    expect(prompt).toContain("Launch Context");
    expect(prompt).toContain("Intent: breakdown");
    expect(prompt).toContain("Kickoff brief");
    expect(prompt).toContain(
      "Turn the parent scope into executable child tasks and keep requirement ownership explicit.",
    );
    expect(prompt).toContain("Work item: EPIC-42 Improve launch workflow");
    expect(prompt).toContain("Project overview (README.md)");
    expect(prompt).toContain("Planning docs (docs/ai)");
    expect(prompt).toContain("launch-brief.md");
    expect(prompt).toContain(
      "The workflow modal should pass its selected context into planning startup.",
    );
  });
});

describe("mapPlanningToolCall", () => {
  it("maps 'create_draft_task' to createDraft with context fields", () => {
    const result = mapPlanningToolCall(
      {
        tool: "create_draft_task",
        args: { title: "Setup CI", description: "Configure CI pipeline" },
      },
      ctx,
    );

    expect(result).toEqual({
      procedure: "createDraft",
      input: {
        sessionId: "sess-001",
        workspaceId: "ws-001",
        projectId: "proj-001",
        title: "Setup CI",
        description: "Configure CI pipeline",
        kind: "task",
        priority: "no_priority",
      },
    });
  });

  it("maps 'update_draft_task' to updateDraft", () => {
    const result = mapPlanningToolCall(
      {
        tool: "update_draft_task",
        args: { id: "draft-1", title: "Updated title" },
      },
      ctx,
    );

    expect(result).toEqual({
      procedure: "updateDraft",
      input: {
        id: "draft-1",
        title: "Updated title",
        description: undefined,
        kind: undefined,
        priority: undefined,
      },
    });
  });

  it("maps 'remove_draft_task' to removeDraft", () => {
    const result = mapPlanningToolCall(
      { tool: "remove_draft_task", args: { id: "draft-2" } },
      ctx,
    );

    expect(result).toEqual({
      procedure: "removeDraft",
      input: { id: "draft-2" },
    });
  });

  it("maps 'set_dependency' to setDependency", () => {
    const result = mapPlanningToolCall(
      {
        tool: "set_dependency",
        args: { draftId: "draft-2", dependsOnDraftId: "draft-1" },
      },
      ctx,
    );

    expect(result).toEqual({
      procedure: "setDependency",
      input: { draftId: "draft-2", dependsOnDraftId: "draft-1" },
    });
  });

  it("returns null for unknown tools", () => {
    const result = mapPlanningToolCall(
      { tool: "unknown_tool", args: {} },
      ctx,
    );

    expect(result).toBeNull();
  });
});
