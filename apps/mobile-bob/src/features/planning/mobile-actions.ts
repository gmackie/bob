import { getAgentChatHref } from "./navigation";

interface MobilePlanningSessionRequestInput {
  workspaceId: string | null;
  projectId: string | null;
  projectName: string | null;
  goal: string;
  workingDirectory?: string;
}

export function buildMobilePlanningSessionRequest(
  input: MobilePlanningSessionRequestInput,
) {
  const goal = input.goal.trim();
  const workingDirectory = input.workingDirectory ?? "/";

  if (!goal || !input.workspaceId || !input.projectId || !input.projectName) {
    return null;
  }

  const workspaceId = input.workspaceId;
  const projectId = input.projectId;
  const projectName = input.projectName;

  return {
    createInput: {
      workspaceId,
      projectId,
      workingDirectory,
      title: goal.slice(0, 256),
      planningSessionType: "shape" as const,
    },
    buildStartInput: (sessionId: string) => ({
      sessionId,
      workspaceId,
      projectId,
      projectName,
      workingDirectory,
      launchContext: {
        intent: "shape" as const,
        notes: goal,
        selectedRepoSources: [],
        attachedFiles: [],
      },
    }),
  };
}

export function getExecutionLaunchState(input: {
  linkedSessionId: string | null;
  isPending: boolean;
}) {
  if (input.linkedSessionId) {
    return {
      disabled: true,
      label: "Work running",
    };
  }

  if (input.isPending) {
    return {
      disabled: true,
      label: "Starting work...",
    };
  }

  return {
    disabled: false,
    label: "Start work",
  };
}

export function getMobilePlanningChatHref(): string {
  return getAgentChatHref();
}
