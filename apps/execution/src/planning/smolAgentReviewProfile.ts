export interface SmolAgentReviewProfileInput {
  sessionId: string;
  workItemId: string;
  pullRequestId: string;
  workItemTitle: string;
  prDiffUrl: string;
  requirements: string[];
  taskDescription: string;
  workingDirectory: string;
}

export interface SmolAgentReviewProfile {
  agentType: "smol-agent";
  runPhase: "review";
  initialPrompt: string;
  env: Record<string, string>;
}

export function buildSmolAgentReviewProfile(
  input: SmolAgentReviewProfileInput,
): SmolAgentReviewProfile {
  const requirementsList = input.requirements.length > 0
    ? input.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "No specific requirements listed.";

  const initialPrompt = [
    "You are performing a code review for a Bob-managed task.",
    `Task: ${input.workItemTitle}`,
    "",
    "## Task Description",
    input.taskDescription,
    "",
    "## Requirements to Verify",
    requirementsList,
    "",
    "## Instructions",
    "1. Read the PR diff and the surrounding codebase for context",
    "2. Check that the implementation satisfies each listed requirement",
    "3. Look for bugs, security issues, and code quality problems",
    "4. Produce your review by calling the submit_review tool with:",
    '   - decision: "approve" or "request_changes"',
    "   - summary: one-paragraph overall assessment",
    "   - comments: array of { file, line, comment } for specific feedback",
    "   - requirementsCoverage: object mapping each requirement to true/false",
    "",
    "Be thorough but fair. Only request changes for genuine issues.",
  ].join("\n");

  return {
    agentType: "smol-agent",
    runPhase: "review",
    initialPrompt,
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_WORK_ITEM_ID: input.workItemId,
      BOB_PR_ID: input.pullRequestId,
      BOB_PR_DIFF_URL: input.prDiffUrl,
      BOB_RUN_PHASE: "review",
      BOB_WORKTREE_PATH: input.workingDirectory,
    },
  };
}
