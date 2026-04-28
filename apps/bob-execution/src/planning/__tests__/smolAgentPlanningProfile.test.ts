import { describe, expect, it } from "vitest";

import { buildSmolAgentPlanningProfile } from "../smolAgentPlanningProfile";

describe("smolAgentPlanningProfile", () => {
  it("builds a planning profile with correct agent type", () => {
    const profile = buildSmolAgentPlanningProfile({
      sessionId: "session-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectName: "Test Project",
      workingDirectory: "/tmp/project",
    });

    expect(profile.agentType).toBe("smol-agent");
  });

  it("includes all required environment variables", () => {
    const profile = buildSmolAgentPlanningProfile({
      sessionId: "session-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectName: "Test Project",
      workingDirectory: "/tmp/project",
    });

    expect(profile.env.BOB_SESSION_ID).toBe("session-1");
    expect(profile.env.BOB_WORKSPACE_ID).toBe("ws-1");
    expect(profile.env.BOB_PROJECT_ID).toBe("proj-1");
    expect(profile.env.BOB_PROJECT_NAME).toBe("Test Project");
    expect(profile.env.BOB_WORKTREE_PATH).toBe("/tmp/project");
  });
});
