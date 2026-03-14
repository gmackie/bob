import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: vi.fn(async () => ({
    workItem: {
      get: vi.fn(async () => ({
        workItem: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          identifier: "BUILD-42",
          title: "Finish the merged task workspace",
          description: "Carry planning context into the execution shell.",
          kind: "task",
          status: "in_progress",
          sequenceNumber: 42,
          project: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            key: "BUILD",
            name: "Builder",
          },
        },
        childCount: 2,
        currentArtifacts: [
          {
            id: "artifact-1",
            artifactRole: "verification",
            artifactType: "verification",
            title: "Verification run",
            summary: "All checks passed",
            url: "https://example.com/verification",
            metadata: { result: "passed" },
            createdAt: new Date("2026-03-13T10:06:00.000Z"),
          },
          {
            id: "artifact-2",
            artifactRole: "review",
            artifactType: "pr",
            title: "Review PR",
            summary: "Open for review",
            url: "https://example.com/pr/42",
            metadata: null,
            createdAt: new Date("2026-03-13T10:05:00.000Z"),
          },
        ],
      })),
    },
    comment: {
      listByWorkItem: vi.fn(async () => [
        {
          id: "comment-1",
          body: "Please keep the handoff focused on validation history.",
          userId: "user-1",
          createdAt: new Date("2026-03-13T10:07:00.000Z"),
        },
      ]),
    },
    taskRun: {
      listByWorkItem: vi.fn(async () => [
        {
          id: "run-1",
          workItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          workItemIdentifier: "BUILD-42",
          sessionId: "11111111-1111-4111-8111-111111111111",
          status: "running",
          branch: "bob/BUILD-42/workspace",
          createdAt: new Date("2026-03-13T10:00:00.000Z"),
          updatedAt: new Date("2026-03-13T10:05:00.000Z"),
          completedAt: null,
          repositoryId: "repo-1",
          worktreeId: "worktree-1",
          pullRequestId: null,
        },
      ]),
    },
    session: {
      get: vi.fn(async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        title: "BUILD-42 live workspace",
        status: "running",
        agentType: "claude",
        workingDirectory: "/tmp/bob/build-42",
        linkedTask: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          identifier: "BUILD-42",
          url: "/work-items/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
      })),
      getWorkflowState: vi.fn(async () => ({
        workflowStatus: "awaiting_review",
        statusMessage: null,
        awaitingInput: null,
      })),
    },
  })),
}));

describe("task workspace page", () => {
  it("renders task context, validation state, artifacts, and run history", async () => {
    const module = await import(
      "../(dashboard)/work-items/[workItemId]/workspace/page"
    );

    const element = await module.default({
      params: Promise.resolve({
        workItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    });
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("Finish the merged task workspace");
    expect(markup).toContain("Resume live workspace");
    expect(markup).toContain("Validation state");
    expect(markup).toContain("All checks passed");
    expect(markup).toContain("Current artifacts");
    expect(markup).toContain("Review PR");
    expect(markup).toContain("Run history");
    expect(markup).toContain("bob/BUILD-42/workspace");
    expect(markup).toContain("Handoff context");
    expect(markup).toContain("Please keep the handoff focused on validation history.");
    expect(markup).toContain(
      "Use this execution workspace to review context, validation evidence, and the latest handoff before resuming work with Bob.",
    );
    expect(markup).not.toContain("Use this task workspace");
  });
});
