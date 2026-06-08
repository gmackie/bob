import { describe, expect, it } from "vitest";

import {
  buildChatWorkspaceHref,
  deriveTaskWorkspaceValidationState,
  getTaskWorkspaceHref,
  resolveTaskWorkspaceTarget,
} from "../../../lib/planning/task-workspace";

describe("task workspace routing", () => {
  it("builds the dedicated planning route for a task workspace", () => {
    expect(getTaskWorkspaceHref("task-123")).toBe("/work-items/task-123/workspace");
    expect(getTaskWorkspaceHref("task-123", "workspace-1")).toBe(
      "/work-items/task-123/workspace?workspace=workspace-1",
    );
  });

  it("marks executable tasks with a linked session as active", () => {
    expect(
      resolveTaskWorkspaceTarget({
        workItem: { id: "task-123", kind: "task" },
        taskRuns: [
          {
            id: "run-1",
            sessionId: "session-456",
            status: "running",
            branch: "bob/BUILD-123",
            createdAt: new Date("2026-03-13T10:00:00.000Z"),
            updatedAt: new Date("2026-03-13T10:05:00.000Z"),
            completedAt: null,
          },
        ],
      }),
    ).toEqual({
      activeRun: {
        id: "run-1",
        sessionId: "session-456",
        status: "running",
        branch: "bob/BUILD-123",
        createdAt: new Date("2026-03-13T10:00:00.000Z"),
        updatedAt: new Date("2026-03-13T10:05:00.000Z"),
        completedAt: null,
      },
      canExecute: true,
      liveHref: buildChatWorkspaceHref("session-456"),
      state: "active",
    });
  });

  it("keeps executable tasks on the planning route when no session exists yet", () => {
    expect(
      resolveTaskWorkspaceTarget({
        workItem: { id: "task-123", kind: "task" },
        taskRuns: [],
      }),
    ).toEqual({
      activeRun: null,
      canExecute: true,
      liveHref: null,
      state: "idle",
    });
  });

  it("prevents non-task work items from opening the execution workspace", () => {
    expect(
      resolveTaskWorkspaceTarget({
        workItem: { id: "issue-123", kind: "issue" },
        taskRuns: [
          {
            id: "run-1",
            sessionId: "session-456",
            status: "running",
            branch: null,
            createdAt: new Date("2026-03-13T10:00:00.000Z"),
            updatedAt: new Date("2026-03-13T10:05:00.000Z"),
            completedAt: null,
          },
        ],
      }),
    ).toEqual({
      activeRun: null,
      canExecute: false,
      liveHref: null,
      state: "unavailable",
    });
  });

  it("prefers the latest verification artifact when deriving validation state", () => {
    expect(
      deriveTaskWorkspaceValidationState([
        {
          id: "artifact-1",
          artifactRole: "verification",
          artifactType: "verification",
          createdAt: new Date("2026-03-13T10:00:00.000Z"),
          metadata: { result: "passed" },
          summary: "All checks passed",
          title: "Verification run",
          url: "https://example.com/verification",
        },
      ]),
    ).toEqual({
      detail: "All checks passed",
      label: "Validation passed",
      tone: "positive",
    });
  });

  it("falls back to review state when no verification artifact exists", () => {
    expect(
      deriveTaskWorkspaceValidationState([
        {
          id: "artifact-1",
          artifactRole: "review",
          artifactType: "pr",
          createdAt: new Date("2026-03-13T10:00:00.000Z"),
          metadata: null,
          summary: "PR is ready for review",
          title: "Open pull request",
          url: "https://example.com/pr/123",
        },
      ]),
    ).toEqual({
      detail: "A review artifact is attached for the current handoff.",
      label: "Awaiting review",
      tone: "warning",
    });
  });
});
