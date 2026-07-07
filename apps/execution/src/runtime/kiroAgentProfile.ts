import type { PlanningTask } from "./taskExecutor";

export interface KiroTaskExecutionProfileInput {
  sessionId: string;
  taskRunId: string;
  task: PlanningTask;
  branch: string;
  workingDirectory: string;
}

export interface KiroTaskExecutionProfile {
  agentType: "kiro";
  initialPrompt: string;
  env: Record<string, string>;
}

export function buildKiroTaskExecutionProfile(
  input: KiroTaskExecutionProfileInput,
): KiroTaskExecutionProfile {
  const descriptionSection = input.task.description?.trim()
    ? `\nTask details:\n${input.task.description.trim()}\n`
    : "";

  const initialPrompt = [
    "You are working in a Bob-managed Kiro task execution session.",
    `Task: ${input.task.identifier} - ${input.task.title}`,
    `Branch: ${input.branch}`,
    `Working directory: ${input.workingDirectory}`,
    descriptionSection.trimEnd(),
    "",
    "Create the implementation on the requested branch, run relevant verification, and prepare the work for review.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    agentType: "kiro",
    initialPrompt,
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_TASK_RUN_ID: input.taskRunId,
      BOB_WORK_ITEM_ID: input.task.id,
      BOB_WORK_ITEM_IDENTIFIER: input.task.identifier,
      BOB_WORKTREE_PATH: input.workingDirectory,
      BOB_AGENT_BACKEND: "kiro",
    },
  };
}
