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
  title: string | null;
  url: string;
}

interface TaskWorkspaceEvent {
  seq: number;
  direction: string;
  eventType: string;
  payload: Record<string, unknown>;
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
