import { describe, expect, it } from "vitest";

import {
  buildMobileChildDispatchRequests,
  formatMobileDispatchAgentLabel,
  getMobileWorkItemDispatchAgentType,
  getWorkItemDetailPresentation,
} from "./work-item-detail";

describe("mobile work-item detail presentation", () => {
  it("prompts issues to promote before execution", () => {
    expect(
      getWorkItemDetailPresentation({
        id: "issue-123",
        kind: "issue",
      }),
    ).toEqual({
      primaryActionLabel: "Promote to task",
      executionHref: "/work-items/issue-123/workspace",
      semanticSummary: "Issues capture work to be shaped before execution.",
      semanticHint: "Promote this issue to a task when it is ready for Bob.",
    });
  });

  it("sends tasks directly into the execution workspace", () => {
    expect(
      getWorkItemDetailPresentation({
        id: "task-123",
        kind: "task",
      }),
    ).toEqual({
      primaryActionLabel: "Open execution workspace",
      executionHref: "/work-items/task-123/workspace",
      semanticSummary: "Tasks are the executable unit for Bob Builder.",
      semanticHint: "Open the execution workspace to chat, review status, and inspect artifacts.",
    });
    expect(
      getWorkItemDetailPresentation({
        id: "task-123",
        kind: "task",
        workspaceId: "workspace-1",
      }).executionHref,
    ).toBe("/work-items/task-123/workspace?workspace=workspace-1");
  });

  it("builds provider-aware child task dispatch requests", () => {
    expect(
      getMobileWorkItemDispatchAgentType({
        settings: { execution: { provider: "cursor" } },
      }),
    ).toBe("cursor-agent");
    expect(
      getMobileWorkItemDispatchAgentType({
        settings: { planning: { defaultAgent: "claude" } },
      }),
    ).toBe("claude");
    expect(getMobileWorkItemDispatchAgentType(null)).toBe("codex");

    expect(
      buildMobileChildDispatchRequests(
        [
          { id: "ready", kind: "task", status: "ready" },
          { id: "todo", kind: "task", status: "todo" },
          { id: "backlog", kind: "task", status: "backlog" },
          { id: "draft", kind: "task", status: "draft" },
          { id: "running", kind: "task", status: "in_progress" },
          { id: "issue", kind: "issue", status: "ready" },
        ],
        "cursor-agent",
      ),
    ).toEqual([
      { workItemId: "ready", agentType: "cursor-agent" },
      { workItemId: "todo", agentType: "cursor-agent" },
      { workItemId: "backlog", agentType: "cursor-agent" },
      { workItemId: "draft", agentType: "cursor-agent" },
    ]);
  });

  it("formats dispatch agent labels for mobile controls", () => {
    expect(formatMobileDispatchAgentLabel("cursor-agent")).toBe("Cursor");
    expect(formatMobileDispatchAgentLabel("codex")).toBe("Codex");
    expect(formatMobileDispatchAgentLabel("claude")).toBe("Claude");
    expect(formatMobileDispatchAgentLabel("smol-agent")).toBe("Smol Agent");
  });
});
