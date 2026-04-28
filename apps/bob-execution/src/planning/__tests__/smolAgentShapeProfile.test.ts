import { describe, expect, it } from "vitest";

import { buildSmolAgentShapeProfile } from "../smolAgentShapeProfile";

describe("smolAgentShapeProfile", () => {
  it("builds a shape profile with correct agent type", () => {
    const profile = buildSmolAgentShapeProfile({
      sessionId: "session-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectName: "Test Project",
      workingDirectory: "/tmp/project",
      workItemId: "wi-1",
      workItemTitle: "New Feature Idea",
    });

    expect(profile.agentType).toBe("smol-agent");
    expect(profile.runPhase).toBe("shape");
  });

  it("includes all required environment variables", () => {
    const profile = buildSmolAgentShapeProfile({
      sessionId: "session-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
      projectName: "Test Project",
      workingDirectory: "/tmp/project",
      workItemId: "wi-1",
      workItemTitle: "New Feature Idea",
    });

    expect(profile.env.BOB_SESSION_ID).toBe("session-1");
    expect(profile.env.BOB_RUN_PHASE).toBe("shape");
    expect(profile.env.BOB_WORK_ITEM_ID).toBe("wi-1");
  });
});
