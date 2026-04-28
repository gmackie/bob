export interface SmolAgentPlanningProfileInput {
  sessionId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  workingDirectory: string;
}

export interface SmolAgentPlanningProfile {
  agentType: "smol-agent";
  env: Record<string, string>;
}

export function buildSmolAgentPlanningProfile(
  input: SmolAgentPlanningProfileInput,
): SmolAgentPlanningProfile {
  return {
    agentType: "smol-agent",
    env: {
      BOB_SESSION_ID: input.sessionId,
      BOB_WORKSPACE_ID: input.workspaceId,
      BOB_PROJECT_ID: input.projectId,
      BOB_PROJECT_NAME: input.projectName,
      BOB_WORKTREE_PATH: input.workingDirectory,
    },
  };
}
