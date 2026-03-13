interface TaskWorkspaceWorkItem {
  id: string;
  identifier: string;
  title: string;
}

interface TaskWorkspaceSession {
  id: string;
  title: string | null;
  status: string;
}

interface TaskWorkspaceAwaitingInput {
  question: string;
  defaultAction: string;
  expiresAt: string;
}

interface TaskWorkspaceWorkflowState {
  workflowStatus: string;
  statusMessage: string | null;
  awaitingInput: TaskWorkspaceAwaitingInput | null;
}

interface TaskWorkspaceArtifact {
  id: string;
  artifactRole: string;
  artifactType: string;
  title: string | null;
  summary?: string | null;
  url: string;
  metadata?: Record<string, unknown> | null;
}

interface TaskWorkspaceEvent {
  seq: number;
  direction: string;
  eventType: string;
  payload: Record<string, unknown>;
}

interface TaskWorkspaceRun {
  id: string;
  status: string;
  branch: string | null;
  sessionId: string | null;
}

export function summarizeSessionEvents(events: TaskWorkspaceEvent[]) {
  return events
    .map((event) => {
      const body =
        typeof event.payload.content === "string"
          ? event.payload.content
          : typeof event.payload.data === "string"
            ? event.payload.data
            : typeof event.payload.message === "string"
              ? event.payload.message
              : null;

      if (!body) {
        return null;
      }

      return {
        id: String(event.seq),
        actor: event.direction === "client" ? "You" : "Bob",
        body,
      };
    })
    .filter((item): item is { id: string; actor: string; body: string } => item !== null);
}

export function buildTaskWorkspaceViewModel(input: {
  workItem: TaskWorkspaceWorkItem;
  session: TaskWorkspaceSession | null;
  workflowState: TaskWorkspaceWorkflowState | null;
  currentArtifacts: TaskWorkspaceArtifact[];
  events: TaskWorkspaceEvent[];
}) {
  const visibleEvents = summarizeSessionEvents(input.events);
  return {
    title: input.session?.title ?? `${input.workItem.identifier} execution`,
    sessionStatus: input.session?.status ?? "not_started",
    workflowStatus: input.workflowState?.workflowStatus ?? "not_started",
    statusMessage: input.workflowState?.statusMessage ?? null,
    awaitingInput: input.workflowState?.awaitingInput ?? null,
    artifactCount: input.currentArtifacts.length,
    latestEventPreview: visibleEvents.at(-1)?.body ?? null,
    inputEnabled: input.session !== null,
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
) {
  const verificationArtifact = artifacts.find(
    (artifact) =>
      artifact.artifactRole === "verification" ||
      artifact.artifactType === "verification",
  );

  if (verificationArtifact) {
    const result = readArtifactResult(verificationArtifact);

    if (result === "passed") {
      return {
        label: "Validation passed",
        detail:
          verificationArtifact.summary?.trim() ||
          "The latest verification run passed.",
        tone: "positive" as const,
      };
    }

    if (result === "failed") {
      return {
        label: "Validation failed",
        detail:
          verificationArtifact.summary?.trim() ||
          "The latest verification run failed.",
        tone: "critical" as const,
      };
    }

    return {
      label: "Validation in progress",
      detail:
        verificationArtifact.summary?.trim() ||
        "A verification artifact is attached, but it does not report a final result yet.",
      tone: "warning" as const,
    };
  }

  const reviewArtifact = artifacts.find(
    (artifact) =>
      artifact.artifactRole === "review" || artifact.artifactType === "pr",
  );

  if (reviewArtifact) {
    return {
      label: "Awaiting review",
      detail: "A review artifact is attached for the current handoff.",
      tone: "warning" as const,
    };
  }

  return {
    label: "Validation not started",
    detail: "No verification or review artifact is attached to the current task yet.",
    tone: "default" as const,
  };
}

export function summarizeTaskRuns(runs: TaskWorkspaceRun[]) {
  return runs.map((run) => ({
    id: run.id,
    label: run.status.replace(/_/g, " "),
    branch: run.branch?.trim() || "No branch recorded",
    hasSession: run.sessionId != null,
  }));
}
