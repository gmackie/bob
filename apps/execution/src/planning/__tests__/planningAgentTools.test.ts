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
