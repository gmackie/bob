import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDatabase } from "./fake-drizzle-db";

vi.mock("../src/services/outbound-webhook", () => ({
  buildIssuePayload: (issue: { id: string }) => ({
    id: issue.id,
  }),
  dispatchWebhook: vi.fn(() => Promise.resolve()),
}));

import { syncIssueFunnelStageFromDeployment } from "../src/routers/forge-deployment";
import { dispatchWebhook } from "../src/services/outbound-webhook";

describe("forge deployment syncIssueFunnelStageFromDeployment", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates all resolved issues and dispatches each webhook", async () => {
    const { db, calls } = createFakeDatabase({
      selectResponses: [
        [{ taskId: "11111111-1111-4111-8111-111111111111" }],
        [{ issueId: "22222222-2222-4222-8222-222222222222" }],
        [
          { id: "11111111-1111-4111-8111-111111111111", funnelStage: "ready_for_execution", projectId: "p1" },
          { id: "22222222-2222-4222-8222-222222222222", funnelStage: "staging_deployed", projectId: "p2" },
        ],
        [
          { workspaceId: "w1" },
        ],
        [{ workspaceId: "w2" }],
      ],
      updateResponses: [
        [{ id: "11111111-1111-4111-8111-111111111111", funnelStage: "staging_verified", projectId: "p1" }],
        [{ id: "22222222-2222-4222-8222-222222222222", funnelStage: "staging_verified", projectId: "p2" }],
      ],
    });

    await syncIssueFunnelStageFromDeployment(
      db as never,
      {
        id: "deploy-1",
        buildId: "build-1",
        revId: "rev-1",
        environment: "staging",
        status: "healthy",
      },
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
    );

    expect(calls.updateCalls).toBe(1);
    expect(dispatchWebhook).toHaveBeenCalledTimes(1);
  });

  it("resolves via build+commit when issueIds are not provided", async () => {
    const { db } = createFakeDatabase({
      selectResponses: [
        [{ taskId: "33333333-3333-4333-8333-333333333333" }],
        [{ issueId: "44444444-4444-4444-8444-444444444444" }],
        [
          { id: "33333333-3333-4333-8333-333333333333", funnelStage: "ready_for_execution", projectId: "p1" },
          { id: "44444444-4444-4444-8444-444444444444", funnelStage: "ready_for_execution", projectId: "p3" },
        ],
        [{ id: "33333333-3333-4333-8333-333333333333", funnelStage: "staging_deployed", projectId: "p1" }],
        [{ workspaceId: "w1" }],
        [{ id: "44444444-4444-4444-8444-444444444444", funnelStage: "staging_deployed", projectId: "p3" }],
        [{ workspaceId: "w3" }],
      ],
      updateResponses: [
        [{ id: "33333333-3333-4333-8333-333333333333", funnelStage: "staging_deployed", projectId: "p1" }],
        [{ id: "44444444-4444-4444-8444-444444444444", funnelStage: "staging_deployed", projectId: "p3" }],
      ],
    });

    await syncIssueFunnelStageFromDeployment(
      db as never,
      {
        id: "deploy-2",
        buildId: "build-2",
        revId: "rev-2",
        environment: "prod",
        status: "healthy",
      }
    );

    expect(dispatchWebhook).toHaveBeenCalledTimes(2);
  });

  it("skips updates when issue is already at the target stage", async () => {
    const { db } = createFakeDatabase({
      selectResponses: [
        [
          {
            id: "55555555-5555-4555-8555-555555555555",
            funnelStage: "staging_verified",
            projectId: "p5",
          },
        ],
      ],
      updateResponses: [],
    });

    await syncIssueFunnelStageFromDeployment(
      db as never,
      {
        id: "deploy-3",
        buildId: "build-3",
        revId: "rev-3",
        environment: "staging",
        status: "healthy",
      },
      ["55555555-5555-4555-8555-555555555555"]
    );

    expect(dispatchWebhook).toHaveBeenCalledTimes(0);
  });
});
