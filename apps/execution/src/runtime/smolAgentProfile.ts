export interface SmolAgentTaskExecutionProfileInput {
  sessionId: string;
  taskRunId: string;
  workItemId: string;
  workItemIdentifier: string;
  title: string;
  description: string | null;
  branch: string;
  workingDirectory: string;
}

export interface SmolAgentTaskExecutionProfile {
  agentType: "smol-agent";
  initialPrompt: string;
  env: Record<string, string>;
}

export function buildSmolAgentLaunchEnv(
  profile: SmolAgentTaskExecutionProfile,
): Record<string, string> {
  return {
    ...profile.env,
    BOB_API_URL: process.env.BOB_API_URL ?? "http://localhost:3000",
    ...(process.env.BOB_API_KEY
      ? { BOB_API_KEY: process.env.BOB_API_KEY }
      : {}),
  };
}

export function buildSmolAgentTaskExecutionProfile(
  input: SmolAgentTaskExecutionProfileInput,
): SmolAgentTaskExecutionProfile {
  const descriptionSection = input.description?.trim()
    ? `\nTask details:\n${input.description.trim()}\n`
    : "";

  const initialPrompt = [
    "You are working in a Bob-managed task execution session.",
    `Task: ${input.workItemIdentifier} - ${input.title}`,
    `Branch: ${input.branch}`,
    `Working directory: ${input.workingDirectory}`,
    descriptionSection.trimEnd(),
    "",
    "Bob workflow requirements:",
    "- Call update_status when you start, change phase, and complete work.",
    "- Use request_input when you need a human decision and include a default_action.",
    "- Use mark_blocked if you cannot continue.",
    "- Use create_pr when implementation is ready for review.",
    "- Use submit_for_review after creating a PR.",
    "- Use complete_task when the task is done.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    agentType: "smol-agent",
    initialPrompt,
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_TASK_RUN_ID: input.taskRunId,
      BOB_WORK_ITEM_ID: input.workItemId,
      BOB_WORK_ITEM_IDENTIFIER: input.workItemIdentifier,
      BOB_WORKTREE_PATH: input.workingDirectory,
    },
  };
}
