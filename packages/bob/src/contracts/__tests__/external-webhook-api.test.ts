import { describe, expect, it } from "vitest";
import { ExternalRpc } from "../groups/external.js";

describe("ExternalRpc — 7B-4C Task 9 (webhook + publicApi)", () => {
  it("has exactly 37 procedures (14 forgegraph + 8 webhook + 9 publicApi + 6 integration)", () => {
    expect(ExternalRpc.requests.size).toBe(37);
  });

  it("contains all 8 webhook procedure names", () => {
    const names = [...ExternalRpc.requests.keys()];
    expect(names).toContain("external.webhook.list");
    expect(names).toContain("external.webhook.byId");
    expect(names).toContain("external.webhook.create");
    expect(names).toContain("external.webhook.update");
    expect(names).toContain("external.webhook.delete");
    expect(names).toContain("external.webhook.deliveries");
    expect(names).toContain("external.webhook.redeliver");
    expect(names).toContain("external.webhook.testWebhook");
  });

  it("contains all 9 publicApi procedure names", () => {
    const names = [...ExternalRpc.requests.keys()];
    expect(names).toContain("external.publicApi.registerWorkspace");
    expect(names).toContain("external.publicApi.createRun");
    expect(names).toContain("external.publicApi.updateRun");
    expect(names).toContain("external.publicApi.createArtifact");
    expect(names).toContain("external.publicApi.getRun");
    expect(names).toContain("external.publicApi.listRuns");
    expect(names).toContain("external.publicApi.listRunsByWorkItem");
    expect(names).toContain("external.publicApi.heartbeat");
    expect(names).toContain("external.publicApi.generateApiKey");
  });

  it("contains all 6 integration procedure names", () => {
    const names = [...ExternalRpc.requests.keys()];
    expect(names).toContain("external.integration.list");
    expect(names).toContain("external.integration.get");
    expect(names).toContain("external.integration.save");
    expect(names).toContain("external.integration.fetchLinearTeams");
    expect(names).toContain("external.integration.setupLinear");
    expect(names).toContain("external.integration.delete");
  });

  it("still contains all 14 forgegraph procedure names", () => {
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
