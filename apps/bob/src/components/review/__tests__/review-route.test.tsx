import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReviewPageRoute from "~/app/(dashboard)/work-items/[workItemId]/review/page";

const { caller } = vi.hoisted(() => ({
  caller: {
    workItem: { get: vi.fn(), listChildArtifactGroups: vi.fn() },
    dispatch: { listBatches: vi.fn(), getBatch: vi.fn() },
    forgegraph: { listRevisions: vi.fn(), listDeployments: vi.fn() },
  },
}));
vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: async () => caller,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("~/components/review/review-page", () => ({
  ReviewPage: "review-page",
}));
vi.mock("~/components/review/artifact-panel", () => ({
  ArtifactPanel: "artifact-panel",
}));
vi.mock("~/components/work-items/work-item-detail-interactive", () => ({
  OutcomeReadableOutputPanel: "readable-output",
}));

const artifact = (
  workItemId: string,
  taskRunId: string,
  decision = "approve",
) => ({
  id: `artifact-${workItemId}`,
  workItemId,
  taskRunId,
  artifactType: "code_review",
  artifactRole: "code_review",
  isCurrent: true,
  content: JSON.stringify({ decision, summary: `Review for ${workItemId}` }),
});
const render = () =>
  ReviewPageRoute({ params: Promise.resolve({ workItemId: "parent" }) });

beforeEach(() => {
  vi.clearAllMocks();
  caller.workItem.get.mockResolvedValue({
    workItem: {
      id: "parent",
      title: "Parent",
      project: { id: "project" },
      workspaceId: "workspace",
    },
    currentArtifacts: [artifact("parent", "parent-run")],
  });
  caller.workItem.listChildArtifactGroups.mockResolvedValue([
    {
      workItem: { id: "child-a", externalId: "external-a" },
      artifacts: [artifact("child-a", "run-a")],
    },
    {
      workItem: { id: "child-b" },
      artifacts: [artifact("child-b", "old-run")],
    },
  ]);
  caller.dispatch.listBatches.mockResolvedValue([
    { id: "batch", projectId: "project", status: "completed" },
  ]);
  caller.dispatch.getBatch.mockResolvedValue({
    items: [
      {
        id: "a",
        planningTaskId: "external-a",
        taskRunId: "run-a",
        title: "A",
        status: "completed",
      },
      {
        id: "b",
        planningTaskId: "child-b",
        taskRunId: "run-b",
        title: "B",
        status: "completed",
      },
    ],
  });
});

describe("work-item review route", () => {
  it("requests the work item's batch and scoped batch contents", async () => {
    await render();
    expect(caller.dispatch.listBatches).toHaveBeenCalledWith({
      workItemId: "parent",
      limit: 1,
    });
    expect(caller.dispatch.getBatch).toHaveBeenCalledWith({
      batchId: "batch",
      workItemId: "parent",
    });
  });
  it("assigns a child review only to its own run, never copies the parent review to every task", async () => {
    const result = (await render()) as ReactElement<{
      codeReviews: Record<string, { summary: string }>;
    }>;
    expect(result.props.codeReviews).toMatchObject({
      a: { summary: "Review for child-a" },
    });
    expect(result.props.codeReviews.b).toBeUndefined();
  });
  it("does not attach an old approval to a queued item with no run", async () => {
    caller.dispatch.getBatch.mockResolvedValue({
      items: [
        {
          id: "a",
          planningTaskId: "external-a",
          taskRunId: null,
          title: "A",
          status: "queued",
        },
      ],
    });
    const result = (await render()) as ReactElement<{
      codeReviews: Record<string, unknown>;
    }>;
    expect(result.props.codeReviews.a).toBeUndefined();
  });
  it("keeps the latest direct execution visible even when an older batch exists", async () => {
    expect(JSON.stringify(await render())).toContain("readable-output");
  });
  it("does not invent an approval for a review without a decision", async () => {
    const incomplete = artifact("child-a", "run-a");
    incomplete.content = JSON.stringify({ summary: "Still reviewing" });
    caller.workItem.listChildArtifactGroups.mockResolvedValue([
      {
        workItem: { id: "child-a", externalId: "external-a" },
        artifacts: [incomplete],
      },
    ]);
    const result = (await render()) as ReactElement<{
      codeReviews: Record<string, unknown>;
    }>;
    expect(result.props.codeReviews.a).toBeUndefined();
  });
  it("shows direct execution output and artifacts when there is no planning batch", async () => {
    caller.dispatch.listBatches.mockResolvedValue([]);
    const result = await render();
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("readable-output");
    expect(serialized).toContain("artifact-parent");
    expect(caller.dispatch.getBatch).not.toHaveBeenCalled();
  });
});
