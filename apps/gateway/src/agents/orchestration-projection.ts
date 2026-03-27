import type { T3DomainEvent } from "./t3code-event-map.js";

export type ProjectionRunPhase = "shape" | "plan" | "execute" | "review" | "ship";

export type ProjectionRunStatus = "starting" | "running" | "blocked" | "completed" | "failed";
export type ProjectionAgentStatus = "starting" | "running" | "blocked" | "completed" | "failed";
export type ProjectionTaskStatus = "starting" | "running" | "blocked" | "completed" | "failed";
export type ProjectionRequestStatus = "open" | "resolved";

export interface TaskRunSeed {
  readonly id: string;
  readonly sessionId?: string | null;
  readonly parentTaskRunId?: string | null;
  readonly runPhase?: ProjectionRunPhase;
  readonly status?: ProjectionRunStatus | "stopping" | "idle";
  readonly workItemId?: string | null;
}

export interface OrchestrationProjectionInput {
  readonly taskRuns?: ReadonlyArray<TaskRunSeed>;
  readonly events?: ReadonlyArray<T3DomainEvent>;
}

export interface OrchestrationProjectionSnapshot {
  readonly rootRunIds: string[];
  readonly runsById: Record<string, OrchestrationRun>;
  readonly agentsById: Record<string, OrchestrationAgent>;
  readonly tasksById: Record<string, OrchestrationTask>;
  readonly requestsById: Record<string, OrchestrationRequest>;
  readonly artifactsById: Record<string, OrchestrationArtifact>;
  readonly links: OrchestrationLink[];
}

export interface OrchestrationRun {
  readonly id: string;
  parentRunId: string | null;
  sessionId: string | null;
  phase: ProjectionRunPhase | null;
  status: ProjectionRunStatus;
  blocker: string | null;
  childRunIds: string[];
  agentIds: string[];
  taskIds: string[];
}

export interface OrchestrationAgent {
  readonly id: string;
  runId: string;
  label: string | null;
  status: ProjectionAgentStatus;
  currentTaskId: string | null;
  taskIds: string[];
  pendingRequestIds: string[];
  artifactIds: string[];
}

export interface OrchestrationTask {
  readonly id: string;
  runId: string;
  agentId: string | null;
  title: string | null;
  status: ProjectionTaskStatus;
  blocker: string | null;
  summary: string | null;
  childTaskRunIds: string[];
}

export interface OrchestrationRequest {
  readonly id: string;
  runId: string;
  question: string | null;
  status: ProjectionRequestStatus;
}

export interface OrchestrationArtifact {
  readonly id: string;
  runId: string;
  agentId: string | null;
  taskId: string | null;
  kind: string | null;
  title: string | null;
  linkedTo: OrchestrationLink[];
}

export interface OrchestrationLink {
  readonly kind: string;
  readonly runId: string;
  readonly sourceId: string;
  readonly targetId: string;
}

function createEmptySnapshot(): OrchestrationProjectionSnapshot {
  return {
    rootRunIds: [],
    runsById: {},
    agentsById: {},
    tasksById: {},
    requestsById: {},
    artifactsById: {},
    links: [],
  };
}

function normalizeRunPhase(value: string | undefined): ProjectionRunPhase | null {
  switch (value) {
    case "shape":
    case "plan":
    case "execute":
    case "review":
    case "ship":
      return value;
    default:
      return null;
  }
}

function normalizeRunStatus(value: string | undefined): ProjectionRunStatus {
  switch (value) {
    case "starting":
    case "running":
    case "blocked":
    case "completed":
    case "failed":
      return value;
    case "stopping":
    case "idle":
    default:
      return "starting";
  }
}

function normalizeAgentStatus(value: string | undefined): ProjectionAgentStatus {
  switch (value) {
    case "starting":
    case "running":
    case "blocked":
    case "completed":
    case "failed":
      return value;
    default:
      return "running";
  }
}

function normalizeTaskStatus(value: string | undefined): ProjectionTaskStatus {
  switch (value) {
    case "starting":
    case "running":
    case "blocked":
    case "completed":
    case "failed":
      return value;
    default:
      return "starting";
  }
}

function ensureRun(snapshot: OrchestrationProjectionSnapshot, runId: string): OrchestrationRun {
  const existing = snapshot.runsById[runId];
  if (existing) {
    return existing;
  }

  const run: OrchestrationRun = {
    id: runId,
    parentRunId: null,
    sessionId: null,
    phase: null,
    status: "starting",
    blocker: null,
    childRunIds: [],
    agentIds: [],
    taskIds: [],
  };
  snapshot.runsById[runId] = run;
  if (!snapshot.rootRunIds.includes(runId)) {
    snapshot.rootRunIds.push(runId);
  }
  return run;
}

function ensureAgent(
  snapshot: OrchestrationProjectionSnapshot,
  agentId: string,
  runId: string,
): OrchestrationAgent {
  const existing = snapshot.agentsById[agentId];
  if (existing) {
    existing.runId = runId;
    return existing;
  }

  const agent: OrchestrationAgent = {
    id: agentId,
    runId,
    label: null,
    status: "running",
    currentTaskId: null,
    taskIds: [],
    pendingRequestIds: [],
    artifactIds: [],
  };
  snapshot.agentsById[agentId] = agent;

  const run = ensureRun(snapshot, runId);
  if (!run.agentIds.includes(agentId)) {
    run.agentIds.push(agentId);
  }
  return agent;
}

function ensureTask(
  snapshot: OrchestrationProjectionSnapshot,
  taskId: string,
  runId: string,
): OrchestrationTask {
  const existing = snapshot.tasksById[taskId];
  if (existing) {
    existing.runId = runId;
    return existing;
  }

  const task: OrchestrationTask = {
    id: taskId,
    runId,
    agentId: null,
    title: null,
    status: "starting",
    blocker: null,
    summary: null,
    childTaskRunIds: [],
  };
  snapshot.tasksById[taskId] = task;

  const run = ensureRun(snapshot, runId);
  if (!run.taskIds.includes(taskId)) {
    run.taskIds.push(taskId);
  }
  return task;
}

function ensureRequest(
  snapshot: OrchestrationProjectionSnapshot,
  requestId: string,
  runId: string,
): OrchestrationRequest {
  const existing = snapshot.requestsById[requestId];
  if (existing) {
    existing.runId = runId;
    return existing;
  }

  const request: OrchestrationRequest = {
    id: requestId,
    runId,
    question: null,
    status: "open",
  };
  snapshot.requestsById[requestId] = request;
  return request;
}

function ensureArtifact(
  snapshot: OrchestrationProjectionSnapshot,
  artifactId: string,
  runId: string,
): OrchestrationArtifact {
  const existing = snapshot.artifactsById[artifactId];
  if (existing) {
    existing.runId = runId;
    return existing;
  }

  const artifact: OrchestrationArtifact = {
    id: artifactId,
    runId,
    agentId: null,
    taskId: null,
    kind: null,
    title: null,
    linkedTo: [],
  };
  snapshot.artifactsById[artifactId] = artifact;
  for (const link of snapshot.links) {
    if (link.sourceId === artifactId) {
      artifact.linkedTo = [...artifact.linkedTo, link];
    }
  }
  return artifact;
}

function attachChildRun(
  snapshot: OrchestrationProjectionSnapshot,
  parentRunId: string,
  childRunId: string,
): void {
  const parent = ensureRun(snapshot, parentRunId);
  const child = ensureRun(snapshot, childRunId);

  child.parentRunId = parentRunId;
  if (!parent.childRunIds.includes(childRunId)) {
    parent.childRunIds.push(childRunId);
  }
  const rootIndex = snapshot.rootRunIds.indexOf(childRunId);
  if (rootIndex !== -1) {
    snapshot.rootRunIds.splice(rootIndex, 1);
  }
}

function seedTaskRuns(
  snapshot: OrchestrationProjectionSnapshot,
  taskRuns: ReadonlyArray<TaskRunSeed>,
): void {
  for (const taskRun of taskRuns) {
    const run = ensureRun(snapshot, taskRun.id);
    run.sessionId = taskRun.sessionId ?? run.sessionId;
    run.phase = normalizeRunPhase(taskRun.runPhase ?? undefined);
    run.status = normalizeRunStatus(taskRun.status);
    if (taskRun.parentTaskRunId) {
      attachChildRun(snapshot, taskRun.parentTaskRunId, taskRun.id);
    } else if (!snapshot.rootRunIds.includes(taskRun.id)) {
      snapshot.rootRunIds.push(taskRun.id);
    }
  }
}

function addLink(snapshot: OrchestrationProjectionSnapshot, link: OrchestrationLink): void {
  snapshot.links.push(link);

  const artifact = snapshot.artifactsById[link.sourceId];
  if (artifact) {
    artifact.linkedTo = [...artifact.linkedTo, link];
  }
}

function markRunAgentsPendingRequest(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
  requestId: string,
): void {
  const run = snapshot.runsById[runId];
  if (!run) {
    return;
  }

  for (const agentId of run.agentIds) {
    const agent = snapshot.agentsById[agentId];
    if (!agent) {
      continue;
    }
    if (!agent.pendingRequestIds.includes(requestId)) {
      agent.pendingRequestIds.push(requestId);
    }
  }
}

function clearRunAgentsPendingRequest(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
  requestId: string,
): void {
  const run = snapshot.runsById[runId];
  if (!run) {
    return;
  }

  for (const agentId of run.agentIds) {
    const agent = snapshot.agentsById[agentId];
    if (!agent) {
      continue;
    }
    agent.pendingRequestIds = agent.pendingRequestIds.filter((pendingId) => pendingId !== requestId);
  }
}

function applyEvent(snapshot: OrchestrationProjectionSnapshot, event: T3DomainEvent): void {
  switch (event.type) {
    case "run.started":
    case "run.updated":
    case "run.completed":
    case "run.failed": {
      const run = ensureRun(snapshot, event.runId);
      run.status = normalizeRunStatus(
        event.status ??
          (event.type === "run.completed"
            ? "completed"
            : event.type === "run.failed"
              ? "failed"
              : "running"),
      );
      return;
    }

    case "agent.spawned": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.label = event.label ?? agent.label;
      agent.status = "running";
      return;
    }

    case "agent.updated": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.status = normalizeAgentStatus(event.status);
      return;
    }

    case "agent.completed": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.status = "completed";
      return;
    }

    case "agent.failed": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.status = "failed";
      return;
    }

    case "agent.task.assigned": {
      const run = ensureRun(snapshot, event.runId);
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      const task = ensureTask(snapshot, event.taskId, event.runId);

      task.agentId = event.agentId;
      task.title = event.title ?? task.title;
      task.status = "running";

      agent.currentTaskId = event.taskId;
      if (!agent.taskIds.includes(event.taskId)) {
        agent.taskIds.push(event.taskId);
      }
      if (!run.taskIds.includes(event.taskId)) {
        run.taskIds.push(event.taskId);
      }
      if (!run.agentIds.includes(event.agentId)) {
        run.agentIds.push(event.agentId);
      }
      return;
    }

    case "agent.task.progressed": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.status = "running";
      task.summary = event.detail ?? task.summary;
      return;
    }

    case "agent.task.blocked": {
      const run = ensureRun(snapshot, event.runId);
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      const task = ensureTask(snapshot, event.taskId, event.runId);

      task.status = "blocked";
      task.blocker = event.blocker ?? task.blocker;
      agent.status = "blocked";
      if (!agent.taskIds.includes(event.taskId)) {
        agent.taskIds.push(event.taskId);
      }
      agent.currentTaskId = event.taskId;
      run.status = "blocked";
      run.blocker = event.blocker ?? run.blocker;
      return;
    }

    case "agent.task.completed": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.status = "completed";
      task.summary = event.summary ?? task.summary;
      return;
    }

    case "agent.task.failed": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.status = "failed";
      task.summary = event.errorMessage ?? task.summary;
      const run = ensureRun(snapshot, event.runId);
      run.status = "failed";
      return;
    }

    case "agent.task.reassigned": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.agentId = event.agentId;
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.currentTaskId = event.taskId;
      if (!agent.taskIds.includes(event.taskId)) {
        agent.taskIds.push(event.taskId);
      }
      return;
    }

    case "request.opened": {
      const run = ensureRun(snapshot, event.runId);
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.question = event.detail ?? request.question;
      request.status = "open";
      run.status = "blocked";
      if (!run.blocker) {
        run.blocker = event.detail ?? run.blocker;
      }
      markRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      return;
    }

    case "request.resolved": {
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.status = "resolved";
      clearRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      return;
    }

    case "user_input.requested": {
      const run = ensureRun(snapshot, event.runId);
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.question = event.question ?? request.question;
      request.status = "open";
      run.status = "blocked";
      if (!run.blocker) {
        run.blocker = event.question ?? run.blocker;
      }
      markRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      return;
    }

    case "user_input.resolved": {
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.status = "resolved";
      clearRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      return;
    }

    case "artifact.produced": {
      const artifact = ensureArtifact(snapshot, event.artifactId, event.runId);
      artifact.kind = event.artifactKind ?? artifact.kind;
      artifact.title = event.title ?? artifact.title;
      return;
    }

    case "artifact.updated": {
      const artifact = ensureArtifact(snapshot, event.artifactId, event.runId);
      artifact.kind = event.artifactKind ?? artifact.kind;
      artifact.title = event.title ?? artifact.title;
      return;
    }

    case "artifact.promoted": {
      const artifact = ensureArtifact(snapshot, event.artifactId, event.runId);
      artifact.kind = event.artifactKind ?? artifact.kind;
      artifact.title = event.title ?? artifact.title;
      return;
    }

    case "link.created": {
      addLink(snapshot, {
        kind: event.linkKind,
        runId: event.runId,
        sourceId: event.sourceId,
        targetId: event.targetId,
      });
      return;
    }
  }
}

export function buildOrchestrationProjection(
  input: OrchestrationProjectionInput = {},
): OrchestrationProjectionSnapshot {
  const snapshot = createEmptySnapshot();
  seedTaskRuns(snapshot, input.taskRuns ?? []);

  for (const event of input.events ?? []) {
    applyEvent(snapshot, event);
  }

  return snapshot;
}
