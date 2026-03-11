import { describe, expect, it } from "vitest";

import {
  buildChatWorkspaceHref,
  getTaskWorkspaceHref,
  resolveTaskWorkspaceTarget,
} from "~/lib/planning/task-workspace";

describe("task workspace routing", () => {
  it("builds the dedicated planning route for a task workspace", () => {
    expect(getTaskWorkspaceHref("task-123")).toBe("/work-items/task-123/workspace");
  });

  it("redirects executable tasks with a linked session into headless chat", () => {
    expect(
      resolveTaskWorkspaceTarget({
        workItem: { id: "task-123", kind: "task" },
        taskRuns: [{ sessionId: "session-456" }],
      }),
    ).toEqual({
      canExecute: true,
      href: buildChatWorkspaceHref("session-456"),
      state: "ready",
    });
  });

  it("keeps executable tasks on the planning route when no session exists yet", () => {
    expect(
      resolveTaskWorkspaceTarget({
        workItem: { id: "task-123", kind: "task" },
        taskRuns: [],
      }),
    ).toEqual({
      canExecute: true,
      href: null,
      state: "waiting",
    });
  });

  it("prevents non-task work items from opening the execution workspace", () => {
    expect(
      resolveTaskWorkspaceTarget({
        workItem: { id: "issue-123", kind: "issue" },
        taskRuns: [{ sessionId: "session-456" }],
      }),
    ).toEqual({
      canExecute: false,
      href: null,
      state: "unavailable",
    });
  });
});
