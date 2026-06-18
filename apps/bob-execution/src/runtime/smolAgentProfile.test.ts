import { describe, expect, it } from "vitest";

import { buildSmolAgentTaskExecutionProfile } from "./smolAgentProfile";

describe("smol-agent task execution profile", () => {
  it("builds a Bob-owned execution prompt for a task run", () => {
    const profile = buildSmolAgentTaskExecutionProfile({
      sessionId: "session-1",
      taskRunId: "task-run-1",
      workItemId: "work-item-1",
      workItemIdentifier: "ENG-42",
      title: "Add ACP bridge",
      description: "Implement the gateway ACP bridge for smol-agent",
      branch: "bob/eng-42/add-acp-bridge",
      workingDirectory: "/tmp/project",
    });

    expect(profile.agentType).toBe("smol-agent");
    expect(profile.initialPrompt).toContain("ENG-42");
    expect(profile.initialPrompt).toContain("update_status");
    expect(profile.initialPrompt).toContain("create_pr");
    expect(profile.initialPrompt).toContain("complete_task");
    expect(profile.env.BOB_SESSION_ID).toBe("session-1");
  });
});
