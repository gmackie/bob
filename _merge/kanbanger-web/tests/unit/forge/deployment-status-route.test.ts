import { describe, expect, it } from "vitest";
import {
  resolveIssueIdsForDeploymentPayload,
  syncIssueFunnelStageFromDeployment,
} from "@/app/api/forge/deployment-status/route";
import { createFakeDatabase } from "./fake-db";

describe("deployment status issue resolution", () => {
  it("combines build task, identifiers, and commit refs", async () => {
    const { db } = createFakeDatabase({
      selectResponses: [
        [{ id: "55555555-5555-4555-8555-555555555555" }],
        [{ issueId: "66666666-6666-4666-8666-666666666666" }],
        [{ taskId: "77777777-7777-4777-8777-777777777777" }],
      ],
    });

    const result = await resolveIssueIdsForDeploymentPayload(db as never, {
      buildId: "88888888-8888-4888-8888-888888888888",
      issueIdentifiers: ["FG-100", "FG-101"],
      commitIds: ["sha-deploy"],
      revId: "sha-deploy",
      imageTag: "image-tag",
    });

    expect(result).toContain("55555555-5555-4555-8555-555555555555");
    expect(result).toContain("66666666-6666-4666-8666-666666666666");
    expect(result).toContain("77777777-7777-4777-8777-777777777777");
    expect(new Set(result).size).toBe(3);
  });

  it("returns empty when no identifiers, links, or task id are available", async () => {
    const { db } = createFakeDatabase({
      selectResponses: [
        [],
        [],
      ],
    });

    const result = await resolveIssueIdsForDeploymentPayload(db as never, {
      buildId: "99999999-9999-4999-8999-999999999999",
      revId: "sha-empty",
      commitIds: ["unknown-commit"],
      imageDigest: "unknown",
    });

    expect(result).toEqual([]);
  });

  it("does not regress issue funnel stage on stale deployment status updates", async () => {
    const { db, calls } = createFakeDatabase({
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
      db as never,
      {
        id: "deployment-id",
        environment: "staging",
        status: "healthy",
      },
      ["stale-issue-id"]
    );

    expect(calls.update).toBe(0);
    expect(calls.insert).toBe(0);
  });
});
