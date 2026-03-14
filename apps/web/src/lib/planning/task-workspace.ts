export interface TaskWorkspaceWorkItem {
  id: string;
  kind: string;
}

export interface TaskWorkspaceArtifact {
  id: string;
  artifactRole: string;
  artifactType: string;
  url: string;
  title: string | null;
  summary: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date | string;
}

export interface TaskWorkspaceRun {
  id: string;
  sessionId: string | null;
  status: string;
  branch: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
}

export interface TaskWorkspaceTarget {
  activeRun: TaskWorkspaceRun | null;
  canExecute: boolean;
  liveHref: string | null;
  state: "active" | "idle" | "unavailable";
}

export interface TaskWorkspaceValidationState {
  detail: string;
  label: string;
  tone: "default" | "positive" | "warning" | "critical";
}

export function getTaskWorkspaceHref(workItemId: string): string {
  return `/work-items/${workItemId}/workspace`;
}

export function buildChatWorkspaceHref(sessionId: string): string {
  const params = new URLSearchParams({
    mode: "headless",
    session: sessionId,
  });

  return `/chat?${params.toString()}`;
}

export function resolveTaskWorkspaceTarget(input: {
  taskRuns: TaskWorkspaceRun[];
  workItem: TaskWorkspaceWorkItem;
}): TaskWorkspaceTarget {
  if (input.workItem.kind !== "task") {
    return {
      activeRun: null,
      canExecute: false,
      liveHref: null,
      state: "unavailable",
    };
  }

  const activeRun = input.taskRuns.find((run) => run.sessionId != null);
  if (!activeRun?.sessionId) {
    return {
      activeRun: null,
      canExecute: true,
      liveHref: null,
      state: "idle",
    };
  }

  return {
    activeRun,
    canExecute: true,
    liveHref: buildChatWorkspaceHref(activeRun.sessionId),
    state: "active",
  };
}

function readArtifactResult(
  artifact: TaskWorkspaceArtifact,
): "passed" | "failed" | null {
  const metadataResult =
    typeof artifact.metadata?.result === "string"
      ? artifact.metadata.result.toLowerCase()
      : null;

  if (metadataResult === "passed" || metadataResult === "failed") {
    return metadataResult;
  }

  const text = `${artifact.title ?? ""} ${artifact.summary ?? ""}`.toLowerCase();
  if (text.includes("pass")) return "passed";
  if (text.includes("fail")) return "failed";

  return null;
}

export function deriveTaskWorkspaceValidationState(
  artifacts: TaskWorkspaceArtifact[],
): TaskWorkspaceValidationState {
  const verificationArtifact = artifacts.find(
    (artifact) =>
      artifact.artifactRole === "verification" ||
      artifact.artifactType === "verification",
  );

  if (verificationArtifact) {
    const result = readArtifactResult(verificationArtifact);

    if (result === "passed") {
      return {
        detail:
          verificationArtifact.summary?.trim() || "The latest verification run passed.",
        label: "Validation passed",
        tone: "positive",
      };
    }

    if (result === "failed") {
      return {
        detail:
          verificationArtifact.summary?.trim() || "The latest verification run failed.",
        label: "Validation failed",
        tone: "critical",
      };
    }

    return {
      detail:
        verificationArtifact.summary?.trim() ||
        "A verification artifact is attached, but it does not report a final result yet.",
      label: "Validation in progress",
      tone: "warning",
    };
  }

  const reviewArtifact = artifacts.find(
    (artifact) => artifact.artifactRole === "review" || artifact.artifactType === "pr",
  );

  if (reviewArtifact) {
    return {
      detail: "A review artifact is attached for the current handoff.",
      label: "Awaiting review",
      tone: "warning",
    };
  }

  return {
    detail: "No verification or review artifact is attached to the current task yet.",
    label: "Validation not started",
    tone: "default",
  };
}
