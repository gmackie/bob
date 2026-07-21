import { describe, expect, it } from "vitest";

import { createBobRpcClient } from "../index.js";

describe("createBobRpcClient", () => {
  it("returns all expected RPC groups", () => {
    const client = createBobRpcClient({ baseURL: "http://127.0.0.1:0/rpc" });

    expect(Object.keys(client).sort()).toEqual([
      "agent",
      "auth",
      "external",
      "planning",
      "projects",
      "secrets",
      "settings",
      "workItems",
    ]);
  });

  it("exposes representative methods for each group", () => {
    const client = createBobRpcClient({ baseURL: "http://127.0.0.1:0/rpc" });

    expect(client.workItems.list).toBeTypeOf("function");
    expect(client.workItems.statusCounts).toBeTypeOf("function");
    expect(client.workItems.notification.list).toBeTypeOf("function");
    expect(client.workItems.taskRun.listLifecycleEvents).toBeTypeOf("function");
    expect(client.planning.listWorkspaces).toBeTypeOf("function");
    expect(client.planning.syncLinearProjects).toBeTypeOf("function");
    expect(client.planning.dispatch.checkProgress).toBeTypeOf("function");
    expect(client.external.forgegraph.listRevisions).toBeTypeOf("function");
    expect(client.external.webhook.list).toBeTypeOf("function");
    expect(client.external.integration.get).toBeTypeOf("function");
    expect(client.external.integration.fetchLinearTeams).toBeTypeOf("function");
    expect(client.agent.listRuns).toBeTypeOf("function");
    expect(client.agent.listAllRuns).toBeTypeOf("function");
    expect(client.agent.run.listAll).toBeTypeOf("function");
    expect(client.agent.capture.listTargets).toBeTypeOf("function");
    expect(client.agent.terminal.createAgentSession).toBeTypeOf("function");
    expect(client.agent.terminal.listByInstance).toBeTypeOf("function");
    expect(client.agent.filesystem.list).toBeTypeOf("function");
    expect(client.agent.filesystem.gitStatus).toBeTypeOf("function");
    expect(client.agent.session.claimLease).toBeTypeOf("function");
    expect(client.agent.session.handleVoiceTranscript).toBeTypeOf("function");
    expect(client.agent.persona.list).toBeTypeOf("function");
    expect(client.projects.list).toBeTypeOf("function");
    expect(client.projects.discovery).toBeTypeOf("function");
    expect(client.projects.updateAutomationSettings).toBeTypeOf("function");
    expect(client.projects.setDefaultAgent).toBeTypeOf("function");
    expect(client.projects.dismissDir).toBeTypeOf("function");
    expect(client.projects.workspace.setDefaultAgent).toBeTypeOf("function");
    expect(client.projects.featureBranch.list).toBeTypeOf("function");
    expect(client.projects.featureBranch.createFeaturePR).toBeTypeOf("function");
    expect(client.settings.getPreferences).toBeTypeOf("function");
    expect(client.secrets.listSessionSecrets).toBeTypeOf("function");
    expect(client.auth.getSession).toBeTypeOf("function");
  });
});
