import { describe, expect, it } from "vitest";

import { buildEnvironmentFleet } from "../environment-fleet-model";

describe("buildEnvironmentFleet", () => {
  const now = new Date("2026-08-03T16:00:00.000Z");

  it("normalizes T3 and Bob hosts into an enterprise fleet summary", () => {
    const fleet = buildEnvironmentFleet({
      now,
      environments: [
        {
          id: "ws-t3",
          name: "Detroit tablet lab",
          slug: "detroit-tablet-lab",
          machineId: "ipad-control-01",
          lastHeartbeat: "2026-08-03T15:59:30.000Z",
          agentConfigs: {
            codex: { available: true, runtime: "t3" },
            claude: { available: false, runtime: "t3" },
          },
        },
        {
          id: "ws-bob",
          name: "Enterprise runner",
          slug: "enterprise-runner",
          machineId: "runner-01",
          lastHeartbeat: "2026-08-03T15:40:00.000Z",
          agentConfigs: { claude: { available: true } },
        },
      ],
      repositories: [
        { id: "repo-1", workspaceId: "ws-t3", dirty: false, stale: false },
        { id: "repo-2", workspaceId: "ws-t3", dirty: true, stale: false },
      ],
      runs: [
        { id: "run-1", workspaceId: "ws-t3", status: "running" },
        { id: "run-2", workspaceId: "ws-t3", status: "queued" },
        { id: "run-3", workspaceId: "ws-bob", status: "failed" },
      ],
    });

    expect(fleet.summary).toEqual({
      total: 2,
      online: 1,
      activeRuns: 2,
      needsAttention: 2,
    });
    expect(fleet.environments[0]).toMatchObject({
      id: "ws-t3",
      runtimeLabel: "T3 control plane",
      status: "online",
      readyProviders: 1,
      providerCount: 2,
      repositoryCount: 2,
      activeRunCount: 2,
      attentionCount: 2,
    });
    expect(fleet.environments[1]).toMatchObject({
      id: "ws-bob",
      runtimeLabel: "Bob native",
      status: "offline",
      attentionCount: 2,
    });
  });

  it("recognizes hybrid hosts and keeps the newest heartbeat first", () => {
    const fleet = buildEnvironmentFleet({
      now,
      environments: [
        {
          id: "older",
          slug: "older",
          lastHeartbeat: "2026-08-03T15:59:00.000Z",
          agentConfigs: { codex: { runtime: "bob" } },
        },
        {
          id: "hybrid",
          slug: "hybrid",
          lastHeartbeat: "2026-08-03T15:59:45.000Z",
          agentConfigs: {
            codex: { runtime: "t3" },
            claude: { runtime: "bob" },
          },
        },
      ],
      repositories: [],
      runs: [],
    });

    expect(fleet.environments.map((environment) => environment.id)).toEqual([
      "hybrid",
      "older",
    ]);
    expect(fleet.environments[0]?.runtimeLabel).toBe("T3 + Bob");
  });
});
