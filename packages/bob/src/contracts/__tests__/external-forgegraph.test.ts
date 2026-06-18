import { describe, expect, it } from "vitest";
import { ExternalRpc } from "../groups/external.js";

describe("ExternalRpc — 7B-4C Task 8", () => {
  it("has exactly 31 procedures (14 forgegraph + 17 webhook/publicApi)", () => {
    expect(ExternalRpc.requests.size).toBe(31);
  });

  it("contains all expected procedure names", () => {
    const names = [...ExternalRpc.requests.keys()];
    expect(names).toContain("external.forgegraph.listRevisions");
    expect(names).toContain("external.forgegraph.getRevision");
    expect(names).toContain("external.forgegraph.createRevision");
    expect(names).toContain("external.forgegraph.triggerBuild");
    expect(names).toContain("external.forgegraph.updateBuildStatus");
    expect(names).toContain("external.forgegraph.createDeployment");
    expect(names).toContain("external.forgegraph.updateDeploymentStatus");
    expect(names).toContain("external.forgegraph.ingestRunEvent");
    expect(names).toContain("external.forgegraph.listDeployments");
    expect(names).toContain("external.forgegraph.listBuilds");
    expect(names).toContain("external.forgegraph.approveProdDeploy");
    expect(names).toContain("external.forgegraph.listApps");
    expect(names).toContain("external.forgegraph.listUnlinkedApps");
    expect(names).toContain("external.forgegraph.importApp");
  });
});
