import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  POST,
  setControlPlaneWebhookDb,
  resolveIssueIdsForRollbackDeployment,
  syncIssueFunnelStageFromDeployment,
} from "@/app/api/webhooks/control-plane/route";
import { createFakeDatabase } from "./fake-db";

afterEach(() => {
  process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "";
  process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "";
  process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
  process.env.PROMETHEUS_BEARER_TOKEN = "";
  setControlPlaneWebhookDb(null);
});

function createMockDatabase({
  selectResponses = [],
  updateResponses = [],
}: {
  selectResponses?: unknown[][];
  updateResponses?: unknown[][];
}) {
  const { db: mockedDb, calls } = createFakeDatabase({ selectResponses, updateResponses });
  const db = mockedDb as never;
  setControlPlaneWebhookDb(db);

  return { calls, db };
}

function toJsonResponse(response: Response) {
  return response.json() as Promise<unknown>;
}

describe("control-plane rollback issue resolution", () => {
  it("resolves issues from build task and commit links", async () => {
    const { db } = createMockDatabase({
      selectResponses: [
        [{ issueId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" }],
        [{ taskId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }],
      ],
    });

    const result = await resolveIssueIdsForRollbackDeployment({
      db: db as never,
      buildId: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
      revision: "sha-rollback",
    });

    expect(result).toContain("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    expect(result).toContain("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb");
    expect(new Set(result).size).toBe(2);
  });

  it("resolves issues from explicit issue ids, identifiers, and commit IDs", async () => {
    const { db } = createMockDatabase({
      selectResponses: [
        [{ id: "cccccccc-cccc-4ccc-cccc-cccccccccccc" }],
        [{ issueId: "dddddddd-dddd-4ddd-bddd-dddddddddddd" }],
        [{ taskId: "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee" }],
      ],
    });

    const result = await resolveIssueIdsForRollbackDeployment({
      db: db as never,
      issueIds: [
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "invalid-uuid",
      ],
      issueIdentifiers: ["FG-123", "FG-124"],
      commitIds: ["sha-commit", "tag-001"],
      revision: "sha-rollback",
      buildId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });

    expect(result).toContain("ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(result).toContain("cccccccc-cccc-4ccc-cccc-cccccccccccc");
    expect(result).toContain("dddddddd-dddd-4ddd-bddd-dddddddddddd");
    expect(result).toContain("eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee");
    expect(result).not.toContain("invalid-uuid");
    expect(new Set(result).size).toBe(4);
  });

  it("uses provided issue ids when syncing funnel stage during rollback", async () => {
    const { db, calls } = createMockDatabase({
      selectResponses: [
        [
          {
            id: "99999999-9999-4999-9999-999999999999",
            projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            funnelStage: "picked_up",
          },
        ],
        [{ workspaceId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" }],
      ],
      updateResponses: [
        [
          {
            id: "99999999-9999-4999-9999-999999999999",
            projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            funnelStage: "staging_verified",
          },
        ],
      ],
    });

    await syncIssueFunnelStageFromDeployment(
      {
        id: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
        buildId: "dddddddd-dddd-4ddd-bddd-dddddddddddd",
        revId: "sha-rollback",
        environment: "prod",
        status: "rolled_back",
      },
      ["99999999-9999-4999-9999-999999999999"],
      db
    );

    expect(calls.select).toBe(2);
  });

  it("does not regress issue funnel stage for stale healthy updates", async () => {
    const { db, calls } = createMockDatabase({
      selectResponses: [
        [
          {
            id: "stale-issue-id",
            projectId: "project-id",
            funnelStage: "staging_verified",
          },
        ],
      ],
    });

    await syncIssueFunnelStageFromDeployment(
      {
        id: "deployment-id",
        buildId: "build-id",
        revId: "rev-id",
        environment: "staging",
        status: "healthy",
      },
      ["stale-issue-id"],
      db
    );

    expect(calls.update).toBe(0);
    expect(calls.insert).toBe(0);
  });

  it("accepts FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN and performs rollback", async () => {
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "forge-token";
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_BEARER_TOKEN = "";

    createMockDatabase({
      selectResponses: [
        [
          {
            id: "11111111-1111-4111-8111-111111111111",
            buildId: null,
            revId: "source-sha",
            environment: "prod",
            status: "deployed",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
        [
          {
            id: "22222222-2222-4222-8222-222222222222",
            revId: "rollback-sha",
            environment: "prod",
            status: "healthy",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
        [],
      ],
      updateResponses: [
        [
          {
            id: "11111111-1111-4111-8111-111111111111",
            buildId: null,
            revId: "source-sha",
            environment: "prod",
            status: "rolled_back",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      ],
    });

    const request = new NextRequest("https://forge.local/api/webhooks/control-plane", {
      method: "POST",
      headers: {
        authorization: "Bearer forge-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repoId: "22222222-2222-4222-8222-222222222222",
        environment: "production",
        sourceDeploymentId: "11111111-1111-4111-8111-111111111111",
        rollbackImageTag: "rollback-sha",
      }),
    });

    const response = await POST(request);
    const payload = (await toJsonResponse(response)) as {
      status: string;
      action: string;
      repoId: string;
      rollbackDeploymentId: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("applied");
    expect(payload.action).toBe("mark_rolled_back");
    expect(payload.rollbackDeploymentId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("normalizes legacy prod environment for control-plane alert payloads", async () => {
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "legacy-token";
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_BEARER_TOKEN = "";

    createMockDatabase({
      selectResponses: [
        [
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "team/repo",
          },
        ],
        [
          {
            id: "44444444-4444-4444-8444-444444444444",
            buildId: null,
            revId: "source-sha-2",
            environment: "prod",
            status: "deployed",
            repoId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        [
          {
            id: "55555555-5555-5555-8555-555555555555",
            revId: "rollback-sha-2",
            environment: "prod",
            status: "healthy",
            repoId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        [],
      ],
      updateResponses: [
        [
          {
            id: "44444444-4444-4444-8444-444444444444",
            buildId: null,
            revId: "source-sha-2",
            environment: "prod",
            status: "rolled_back",
            repoId: "33333333-3333-4333-8333-333333333333",
          },
        ],
      ],
    });

    const request = new NextRequest("https://forge.local/api/webhooks/control-plane", {
      method: "POST",
      headers: {
        authorization: "Bearer legacy-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "alertmanager",
        repoName: "team/repo",
        environment: "prod",
        sourceDeploymentId: "44444444-4444-4444-8444-444444444444",
        rollbackImageTag: "rollback-sha-2",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("returns unauthorized when token does not match", async () => {
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "expected-token";
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_BEARER_TOKEN = "";

    const request = new NextRequest("https://forge.local/api/webhooks/control-plane", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repoId: "22222222-2222-4222-8222-222222222222",
        environment: "production",
        sourceDeploymentId: "11111111-1111-4111-8111-111111111111",
        rollbackImageTag: "rollback-sha",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(await toJsonResponse(response)).toEqual({ error: "Unauthorized" });
  });
});

describe("control-plane endpoint request contract", () => {
  it("accepts legacy prod environment payload in control-plane events", async () => {
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "legacy-token";
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_BEARER_TOKEN = "";

    createMockDatabase({
      selectResponses: [
        [
          {
            id: "11111111-1111-4111-8111-111111111111",
            buildId: null,
            revId: "source-sha-3",
            environment: "prod",
            status: "deployed",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
        [
          {
            id: "33333333-3333-4333-8333-333333333333",
            revId: "rollback-sha-3",
            environment: "prod",
            status: "healthy",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      ],
      updateResponses: [
        [
          {
            id: "11111111-1111-4111-8111-111111111111",
            buildId: null,
            revId: "source-sha-3",
            environment: "prod",
            status: "rolled_back",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      ],
    });

    const request = new NextRequest("https://forge.local/api/webhooks/control-plane", {
      method: "POST",
      headers: {
        authorization: "Bearer legacy-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "control-plane",
        repoId: "22222222-2222-4222-8222-222222222222",
        environment: "prod",
        sourceDeploymentId: "11111111-1111-4111-8111-111111111111",
        rollbackImageTag: "rollback-sha-3",
      }),
    });

    const response = await POST(request);
    const payload = (await toJsonResponse(response)) as { status: string };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("applied");
  });

  it("deduplicates repeated rollback callbacks for same replay key", async () => {
    process.env.FORGEGRAPH_CONTROL_PLANE_WEBHOOK_TOKEN = "dedupe-token";
    process.env.CONTROL_PLANE_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_WEBHOOK_TOKEN = "";
    process.env.PROMETHEUS_BEARER_TOKEN = "";

    createMockDatabase({
      selectResponses: [
        [
          {
            id: "77777777-7777-4777-8777-777777777777",
            buildId: null,
            revId: "source-sha-4",
            environment: "prod",
            status: "deployed",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
        [
          {
            id: "88888888-8888-4888-8888-888888888888",
            revId: "rollback-sha-4",
            environment: "prod",
            status: "healthy",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      ],
      updateResponses: [
        [
          {
            id: "77777777-7777-4777-8777-777777777777",
            buildId: null,
            revId: "source-sha-4",
            environment: "prod",
            status: "rolled_back",
            repoId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      ],
    });

    const payload = {
      repoId: "22222222-2222-4222-8222-222222222222",
      environment: "prod",
      sourceDeploymentId: "77777777-7777-4777-8777-777777777777",
      rollbackImageTag: "rollback-sha-4",
    };

    const firstRequest = new NextRequest("https://forge.local/api/webhooks/control-plane", {
      method: "POST",
      headers: {
        authorization: "Bearer dedupe-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const firstResponse = await POST(firstRequest);
    const firstBody = (await toJsonResponse(firstResponse)) as {
      status: string;
    };

    expect(firstResponse.status).toBe(200);
    expect(firstBody.status).toBe("applied");

    const secondRequest = new NextRequest("https://forge.local/api/webhooks/control-plane", {
      method: "POST",
      headers: {
        authorization: "Bearer dedupe-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const secondResponse = await POST(secondRequest);
    const secondBody = (await toJsonResponse(secondResponse)) as {
      status: string;
      action?: string;
    };

    expect(secondResponse.status).toBe(200);
    expect(secondBody.status).toBe("deduped");
    expect(secondBody.action).toBe("deduped");
  });
});
