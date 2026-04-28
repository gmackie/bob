export interface SmolAgentShapeProfileInput {
  sessionId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  workingDirectory: string;
  workItemId: string;
  workItemTitle: string;
}

export interface SmolAgentShapeProfile {
  agentType: "smol-agent";
  runPhase: "shape";
  env: Record<string, string>;
}

export function buildSmolAgentShapeProfile(
  input: SmolAgentShapeProfileInput,
): SmolAgentShapeProfile {
  return {
    agentType: "smol-agent",
    runPhase: "shape",
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_WORKSPACE_ID: input.workspaceId,
      BOB_PROJECT_ID: input.projectId,
      BOB_PROJECT_NAME: input.projectName,
      BOB_WORKTREE_PATH: input.workingDirectory,
      BOB_WORK_ITEM_ID: input.workItemId,
      BOB_WORK_ITEM_TITLE: input.workItemTitle,
      BOB_RUN_PHASE: "shape",
    },
  };
}
