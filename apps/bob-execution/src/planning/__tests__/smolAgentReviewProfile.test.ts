import { describe, expect, it } from "vitest";
import { buildSmolAgentReviewProfile } from "../smolAgentReviewProfile";

describe("smolAgentReviewProfile", () => {
  it("builds a review profile with correct agent type and phase", () => {
    const profile = buildSmolAgentReviewProfile({
      sessionId: "session-1",
      workItemId: "wi-1",
      pullRequestId: "pr-1",
      workItemTitle: "Add auth module",
      prDiffUrl: "https://github.com/org/repo/pull/42.diff",
      requirements: ["User can login", "Session expires after 30 min"],
      taskDescription: "Implement OAuth2 login flow",
      workingDirectory: "/tmp/project",
    });

    expect(profile.agentType).toBe("smol-agent");
    expect(profile.runPhase).toBe("review");
    expect(profile.env.BOB_RUN_PHASE).toBe("review");
    expect(profile.env.BOB_PR_DIFF_URL).toBe("https://github.com/org/repo/pull/42.diff");
    expect(profile.initialPrompt).toContain("code review");
    expect(profile.initialPrompt).toContain("User can login");
  });
});
