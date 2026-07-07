import { describe, expect, it } from "vitest";

import { buildKiroTaskExecutionProfile } from "./kiroAgentProfile";

describe("Kiro task execution profile", () => {
  it("builds a Kiro launch profile with Bob task context", () => {
    const profile = buildKiroTaskExecutionProfile({
      sessionId: "session-1",
      taskRunId: "run-1",
      task: {
        id: "task-1",
        identifier: "ENG-42",
        title: "Add Kiro backend support",
        description: "Wire the launch profile",
        workspaceId: "workspace-1",
        projectId: "project-1",
        assigneeId: null,
        labels: [],
        priority: 2,
      },
      branch: "bob/ENG-42/add-kiro-backend-support",
      workingDirectory: "/repo",
    });

    expect(profile.agentType).toBe("kiro");
    expect(profile.initialPrompt).toContain("ENG-42");
    expect(profile.initialPrompt).toContain("Wire the launch profile");
    expect(profile.env.BOB_SESSION_ID).toBe("session-1");
    expect(profile.env.BOB_AGENT_BACKEND).toBe("kiro");
  });
});
