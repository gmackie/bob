import type { T3DomainEvent } from "./t3code-event-map.js";

export type ProjectionRunPhase =
  | "shape"
  | "plan"
  | "execute"
  | "review"
  | "ship";

export type ProjectionRunStatus =
  | "starting"
  | "running"
  | "blocked"
  | "completed"
  | "failed";
export type ProjectionAgentStatus =
  | "starting"
  | "running"
  | "blocked"
  | "completed"
  | "failed";
export type ProjectionTaskStatus =
  | "starting"
  | "running"
  | "blocked"
  | "completed"
  | "failed";
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
  readonly taskRuns?: readonly TaskRunSeed[];
  readonly events?: readonly T3DomainEvent[];
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

function normalizeRunPhase(
  value: string | undefined,
): ProjectionRunPhase | null {
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

function normalizeAgentStatus(
  value: string | undefined,
): ProjectionAgentStatus {
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

function ensureRun(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
): OrchestrationRun {
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
    if (existing.runId !== runId) {
      const previousRun = snapshot.runsById[existing.runId];
      if (previousRun) {
        previousRun.agentIds = previousRun.agentIds.filter(
          (existingAgentId) => existingAgentId !== agentId,
        );
      }
      existing.runId = runId;
    }

    const run = ensureRun(snapshot, runId);
    if (!run.agentIds.includes(agentId)) {
      run.agentIds.push(agentId);
    }
    inheritOpenRequestsForAgent(snapshot, existing);
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
  inheritOpenRequestsForAgent(snapshot, agent);
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
  const previousParentRunId = child.parentRunId;

  if (previousParentRunId && previousParentRunId !== parentRunId) {
    const previousParent = snapshot.runsById[previousParentRunId];
    if (previousParent) {
      previousParent.childRunIds = previousParent.childRunIds.filter(
        (existingChildRunId) => existingChildRunId !== childRunId,
      );
      syncRunChildTaskHierarchy(snapshot, previousParentRunId);
    }
  }

  child.parentRunId = parentRunId;
  if (!parent.childRunIds.includes(childRunId)) {
    parent.childRunIds.push(childRunId);
  }
  const rootIndex = snapshot.rootRunIds.indexOf(childRunId);
  if (rootIndex !== -1) {
    snapshot.rootRunIds.splice(rootIndex, 1);
  }

  linkChildRunToParentTask(snapshot, parentRunId, childRunId);
}

function seedTaskRuns(
  snapshot: OrchestrationProjectionSnapshot,
  taskRuns: readonly TaskRunSeed[],
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

function addLink(
  snapshot: OrchestrationProjectionSnapshot,
  link: OrchestrationLink,
): void {
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

function getOpenRequestIdsForRun(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
): string[] {
  return Object.values(snapshot.requestsById)
    .filter((request) => request.runId === runId && request.status === "open")
    .map((request) => request.id);
}

function getBlockedTaskIdsForRun(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
): string[] {
  return Object.values(snapshot.tasksById)
    .filter((task) => task.runId === runId && task.status === "blocked")
    .map((task) => task.id);
}

function recomputeAgentStatus(
  snapshot: OrchestrationProjectionSnapshot,
  agentId: string,
): void {
  const agent = snapshot.agentsById[agentId];
  if (!agent) {
    return;
  }

  agent.pendingRequestIds = agent.pendingRequestIds.filter((requestId) => {
    const request = snapshot.requestsById[requestId];
    return request?.status === "open";
  });

  if (agent.pendingRequestIds.length > 0) {
    agent.status = "blocked";
    return;
  }

  const currentTaskId = agent.currentTaskId;
  if (!currentTaskId) {
    if (agent.status !== "completed" && agent.status !== "failed") {
      agent.status = "running";
    }
    return;
  }

  const currentTask = snapshot.tasksById[currentTaskId];
  if (!currentTask) {
    if (agent.status !== "completed" && agent.status !== "failed") {
      agent.status = "running";
    }
    return;
  }

  switch (currentTask.status) {
    case "blocked":
      agent.status = "blocked";
      return;
    case "completed":
      agent.status = "completed";
      return;
    case "failed":
      agent.status = "failed";
      return;
    default:
      agent.status = "running";
      return;
  }
}

function recomputeRunStatus(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
): void {
  const run = snapshot.runsById[runId];
  if (!run || run.status === "completed" || run.status === "failed") {
    return;
  }

  const openRequestIds = getOpenRequestIdsForRun(snapshot, runId);
  const blockedTaskIds = getBlockedTaskIdsForRun(snapshot, runId);

  if (openRequestIds.length > 0) {
    const requestId = openRequestIds[0];
    if (!requestId) {
      return;
    }
    const request = snapshot.requestsById[requestId];
    if (!request) {
      return;
    }
    run.status = "blocked";
    run.blocker = request.question ?? run.blocker;
    return;
  }

  if (blockedTaskIds.length > 0) {
    const taskId = blockedTaskIds[0];
    if (!taskId) {
      return;
    }
    const task = snapshot.tasksById[taskId];
    if (!task) {
      return;
    }
    run.status = "blocked";
    run.blocker = task.blocker ?? run.blocker;
    return;
  }

  run.blocker = null;
  const agentStatuses = run.agentIds
    .map((agentId) => snapshot.agentsById[agentId]?.status)
    .filter((status): status is ProjectionAgentStatus => Boolean(status));

  if (
    agentStatuses.length > 0 &&
    agentStatuses.every((status) => status === "failed")
  ) {
    run.status = "failed";
    return;
  }

  if (
    agentStatuses.length > 0 &&
    agentStatuses.some((status) => status === "failed")
  ) {
    run.status = "failed";
    return;
  }

  if (
    agentStatuses.length > 0 &&
    agentStatuses.every((status) => status === "completed")
  ) {
    run.status = "completed";
    return;
  }

  // If no agents are blocked, failed, or completed, ensure run is "running".
  // This handles the case where agentStatuses is empty (no agents yet).
  if (run.status !== "running") {
    run.status = "running";
  }
}

function inheritOpenRequestsForAgent(
  snapshot: OrchestrationProjectionSnapshot,
  agent: OrchestrationAgent,
): void {
  const openRequestIds = getOpenRequestIdsForRun(snapshot, agent.runId);
  for (const requestId of openRequestIds) {
    if (!agent.pendingRequestIds.includes(requestId)) {
      agent.pendingRequestIds.push(requestId);
    }
  }
  recomputeAgentStatus(snapshot, agent.id);
}

function clearAgentTaskOwnership(
  snapshot: OrchestrationProjectionSnapshot,
  agentId: string,
  taskId: string,
): void {
  const agent = snapshot.agentsById[agentId];
  if (!agent) {
    return;
  }

  agent.taskIds = agent.taskIds.filter((ownedTaskId) => ownedTaskId !== taskId);
  if (agent.currentTaskId === taskId) {
    agent.currentTaskId = null;
  }
  recomputeAgentStatus(snapshot, agentId);
}

function linkChildRunToParentTask(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
  childRunId: string,
): void {
  const run = snapshot.runsById[runId];
  if (!run) {
    return;
  }

  for (const agentId of run.agentIds) {
    const agent = snapshot.agentsById[agentId];
    const currentTaskId = agent?.currentTaskId;
    if (typeof currentTaskId !== "string") {
      continue;
    }

    const task = snapshot.tasksById[currentTaskId];
    if (task?.runId !== runId) {
      continue;
    }

    if (!task.childTaskRunIds.includes(childRunId)) {
      task.childTaskRunIds.push(childRunId);
    }
    return;
  }

  for (let index = run.taskIds.length - 1; index >= 0; index -= 1) {
    const taskId = run.taskIds[index];
    if (typeof taskId !== "string") {
      continue;
    }

    const task = snapshot.tasksById[taskId];
    if (task?.runId !== runId) {
      continue;
    }

    if (!task.childTaskRunIds.includes(childRunId)) {
      task.childTaskRunIds.push(childRunId);
    }
    return;
  }
}

function syncRunChildTaskHierarchy(
  snapshot: OrchestrationProjectionSnapshot,
  runId: string,
): void {
  const run = snapshot.runsById[runId];
  if (!run) {
    return;
  }

  for (const taskId of run.taskIds) {
    const task = snapshot.tasksById[taskId];
    if (task?.runId !== runId) {
      continue;
    }
    task.childTaskRunIds = task.childTaskRunIds.filter(
      (childTaskRunId) => !run.childRunIds.includes(childTaskRunId),
    );
  }

  for (const childRunId of run.childRunIds) {
    linkChildRunToParentTask(snapshot, runId, childRunId);
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
    agent.pendingRequestIds = agent.pendingRequestIds.filter(
      (pendingId) => pendingId !== requestId,
    );
    recomputeAgentStatus(snapshot, agentId);
  }

  recomputeRunStatus(snapshot, runId);
}

function applyEvent(
  snapshot: OrchestrationProjectionSnapshot,
  event: T3DomainEvent,
): void {
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
      recomputeAgentStatus(snapshot, agent.id);
      return;
    }

    case "agent.updated": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.status = normalizeAgentStatus(event.status);
      recomputeAgentStatus(snapshot, agent.id);
      return;
    }

    case "agent.completed": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.status = "completed";
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "agent.failed": {
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.status = "failed";
      recomputeRunStatus(snapshot, event.runId);
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
      syncRunChildTaskHierarchy(snapshot, event.runId);
      recomputeAgentStatus(snapshot, event.agentId);
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "agent.task.progressed": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.status = "running";
      task.blocker = null;
      task.summary = event.detail ?? task.summary;
      const agentId = task.agentId ?? event.agentId;
      if (agentId) {
        recomputeAgentStatus(snapshot, agentId);
      }
      recomputeRunStatus(snapshot, event.runId);
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
      syncRunChildTaskHierarchy(snapshot, event.runId);
      recomputeAgentStatus(snapshot, event.agentId);
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "agent.task.completed": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.status = "completed";
      task.summary = event.summary ?? task.summary;
      const agentId = task.agentId ?? event.agentId;
      if (agentId) {
        recomputeAgentStatus(snapshot, agentId);
      }
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "agent.task.failed": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      task.status = "failed";
      task.summary = event.errorMessage;
      const run = ensureRun(snapshot, event.runId);
      run.status = "failed";
      const agentId = task.agentId ?? event.agentId;
      if (agentId) {
        recomputeAgentStatus(snapshot, agentId);
      }
      return;
    }

    case "agent.task.reassigned": {
      const task = ensureTask(snapshot, event.taskId, event.runId);
      const previousAgentId = event.previousAgentId ?? task.agentId;
      if (previousAgentId && previousAgentId !== event.agentId) {
        clearAgentTaskOwnership(snapshot, previousAgentId, event.taskId);
      }
      task.agentId = event.agentId;
      const agent = ensureAgent(snapshot, event.agentId, event.runId);
      agent.currentTaskId = event.taskId;
      if (!agent.taskIds.includes(event.taskId)) {
        agent.taskIds.push(event.taskId);
      }
      syncRunChildTaskHierarchy(snapshot, event.runId);
      recomputeAgentStatus(snapshot, event.agentId);
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "request.opened": {
      const run = ensureRun(snapshot, event.runId);
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.question = event.detail ?? request.question;
      request.status = "open";
      run.status = "blocked";
      run.blocker ??= event.detail ?? null;
      markRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "request.resolved": {
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.status = "resolved";
      clearRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "user_input.requested": {
      const run = ensureRun(snapshot, event.runId);
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.question = event.question ?? request.question;
      request.status = "open";
      run.status = "blocked";
      run.blocker ??= event.question ?? null;
      markRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      recomputeRunStatus(snapshot, event.runId);
      return;
    }

    case "user_input.resolved": {
      const request = ensureRequest(snapshot, event.requestId, event.runId);
      request.status = "resolved";
      clearRunAgentsPendingRequest(snapshot, event.runId, event.requestId);
      recomputeRunStatus(snapshot, event.runId);
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
