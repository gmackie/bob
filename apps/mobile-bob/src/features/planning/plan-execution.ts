/**
 * The mobile plan → task → run loop.
 *
 * A planning session drafts tasks. Bob files each one as an issue on the
 * planning board, then running them opens a dispatch batch and each row can
 * open the live session.
 */

// Full window width. The iPad shell already spends ~300pt on its sidebar once
// the window reaches 900, so the task column waits until a landscape iPad
// still has room for the planning chat beside it.
export const PLAN_SPLIT_MIN_WIDTH = 1100;

export type PlanPanelMode = "column" | "bar" | "expanded";

export type PlanStatusTone = "default" | "warning" | "success" | "danger";

export interface PlanDraftView {
  id: string;
  title: string;
  description: string | null;
  meta: string;
  blockedBy: string[];
}

export interface PlanBatchItemView {
  id: string;
  identifier: string;
  title: string;
  status: string;
  statusLabel: string;
  tone: PlanStatusTone;
  watchSessionId: string | null;
}

export interface PlanBatchView {
  id: string;
  status: string;
  statusLabel: string;
  tone: PlanStatusTone;
  total: number;
  completed: number;
  failed: number;
  progressLabel: string;
  items: PlanBatchItemView[];
}

export interface CommittedPlanTask {
  draftId: string;
  taskId: string;
  identifier: string;
}

export interface ReadyPlanTask extends CommittedPlanTask {
  title: string;
}

export interface PlanPrimaryAction {
  key: "create" | "run" | "none";
  label: string;
  disabled: boolean;
}

export interface PlanExecutionView {
  phase: "loading" | "empty" | "drafts" | "ready" | "batch";
  title: string;
  detail: string;
  drafts: PlanDraftView[];
  batch: PlanBatchView | null;
  primaryAction: PlanPrimaryAction;
  error: string | null;
}

export interface WatchableSession {
  sessionId: string;
  workItemId?: string | null;
}

const HIDDEN_PRIORITIES = new Set(["", "no_priority", "none"]);

export function getPlanExecutionLayout(width: number): "split" | "stack" {
  return width >= PLAN_SPLIT_MIN_WIDTH ? "split" : "stack";
}

export function getPlanPanelMode(
  layout: "split" | "stack",
  expanded: boolean,
): PlanPanelMode {
  if (layout === "split") return "column";
  return expanded ? "expanded" : "bar";
}

export function shouldPollBatchProgress(status: string | null | undefined): boolean {
  return status === "running" || status === "dispatching";
}

export function buildCreateBatchInput(
  sessionId: string,
  tasks: readonly CommittedPlanTask[],
) {
  return {
    sessionId,
    concurrency: 2,
    tasks: tasks.map((task) => ({
      draftId: task.draftId,
      taskId: task.taskId,
      identifier: task.identifier,
    })),
  };
}

export function formatPlanLabel(value: string): string {
  const cleaned = value.replaceAll("_", " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function parsePlanningDrafts(value: unknown): PlanDraftView[] {
  const record = asRecord(value);
  const drafts = asRecords(record?.drafts);
  const dependencies = asRecords(record?.dependencies);
  const titleById = new Map<string, string>();

  for (const draft of drafts) {
    const id = readString(draft.id);
    const title = readString(draft.title);
    if (id && title) titleById.set(id, title);
  }

  return drafts.flatMap((draft) => {
    if (readString(draft.status) !== "draft") return [];
    const id = readString(draft.id);
    const title = readString(draft.title);
    if (!id || !title) return [];

    const kind = readString(draft.kind);
    const priority = readString(draft.priority);
    const meta = [kind ? formatPlanLabel(kind) : null, priorityLabel(priority)]
      .filter((part): part is string => Boolean(part))
      .join(" · ");

    const blockedBy = dependencies.flatMap((dependency) => {
      if (readString(dependency.draftId) !== id) return [];
      const blockerId = readString(dependency.dependsOnDraftId);
      const blockerTitle = blockerId ? titleById.get(blockerId) : undefined;
      return blockerTitle ? [blockerTitle] : [];
    });

    return [
      {
        id,
        title,
        description: readString(draft.description),
        meta: meta || "Task",
        blockedBy,
      },
    ];
  });
}

export function parseCommittedPlanTasks(value: unknown): ReadyPlanTask[] {
  const record = asRecord(value);
  return asRecords(record?.drafts).flatMap((draft) => {
    if (readString(draft.status) !== "committed") return [];
    const draftId = readString(draft.id);
    const title = readString(draft.title);
    const identifier = readString(draft.planningTaskIdentifier);
    const taskId = readString(draft.workItemId) ?? readString(draft.planningTaskId);
    if (!draftId || !title || !identifier || !taskId) return [];
    return [{ draftId, taskId, identifier, title }];
  });
}

export function parseCommitPlanResult(value: unknown): {
  committed: number;
  tasks: CommittedPlanTask[];
} | null {
  const record = asRecord(value);
  if (!record || typeof record.committed !== "number") return null;

  const tasks = asRecords(record.tasks).flatMap((task) => {
    const draftId = readString(task.draftId);
    const taskId = readString(task.taskId);
    const identifier = readString(task.identifier);
    if (!draftId || !taskId || !identifier) return [];
    return [{ draftId, taskId, identifier }];
  });

  return { committed: record.committed, tasks };
}

export function parseDispatchBatch(
  value: unknown,
  sessions: readonly WatchableSession[] = [],
  planningSessionId?: string,
): PlanBatchView | null {
  const record = asRecord(value);
  const batch = asRecord(record?.batch);
  const id = readString(batch?.id);
  const status = readString(batch?.status);
  if (!batch || !id || !status) return null;

  const items = asRecords(record?.items).flatMap((item) => {
    const itemId = readString(item.id);
    const title = readString(item.title);
    const itemStatus = readString(item.status) ?? "queued";
    if (!itemId || !title) return [];

    const planningTaskId = readString(item.planningTaskId) ?? "";
    const workItemId = readString(item.workItemId);

    return [
      {
        id: itemId,
        identifier: readString(item.planningTaskIdentifier) ?? "",
        title,
        status: itemStatus,
        statusLabel: formatPlanLabel(itemStatus),
        tone: taskStatusTone(itemStatus),
        watchSessionId: resolveWatchSessionId({
          itemSessionId: readString(item.sessionId),
          planningTaskId,
          workItemId,
          planningSessionId: planningSessionId ?? null,
          sessions,
        }),
      },
    ];
  });

  const completed = numberOr(batch.completedTasks, countStatus(items, "completed"));
  const failed = numberOr(batch.failedTasks, countStatus(items, "failed"));
  const total = numberOr(batch.totalTasks, items.length);

  return {
    id,
    status,
    statusLabel: formatPlanLabel(status),
    tone: batchStatusTone(status, failed),
    total,
    completed,
    failed,
    progressLabel: buildProgressLabel(items, total, completed, failed),
    items,
  };
}

export function findBatchForPlanningSession<
  T extends { id: string; sessionId?: string | null },
>(batches: readonly T[], sessionId: string): T | null {
  return batches.find((batch) => batch.sessionId === sessionId) ?? null;
}

export function parseBatchList(value: unknown): { id: string; sessionId: string | null }[] {
  return asRecords(value).flatMap((batch) => {
    const id = readString(batch.id);
    if (!id) return [];
    return [{ id, sessionId: readString(batch.sessionId) }];
  });
}

export function resolveWatchSessionId(input: {
  itemSessionId: string | null;
  planningTaskId: string;
  workItemId: string | null;
  planningSessionId: string | null;
  sessions: readonly WatchableSession[];
}): string | null {
  if (input.itemSessionId && input.itemSessionId !== input.planningSessionId) {
    return input.itemSessionId;
  }

  const taskIds = new Set(
    [input.planningTaskId, input.workItemId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  if (taskIds.size === 0) return null;

  const match = input.sessions.find(
    (session) =>
      session.sessionId !== input.planningSessionId &&
      session.workItemId != null &&
      taskIds.has(session.workItemId),
  );
  return match?.sessionId ?? null;
}

export function buildPlanExecutionView(input: {
  isLoading: boolean;
  loadError: string | null;
  actionError: string | null;
  drafts: readonly PlanDraftView[];
  readyTasks?: readonly ReadyPlanTask[];
  batch: PlanBatchView | null;
  isCreating: boolean;
  isRunning: boolean;
}): PlanExecutionView {
  const error = input.actionError ?? input.loadError;
  const readyTasks = input.readyTasks ?? [];

  if (input.batch) {
    const canRun = input.batch.status === "pending";
    return {
      phase: "batch",
      title: "Tasks",
      detail: input.batch.progressLabel,
      drafts: [],
      batch: input.batch,
      primaryAction: canRun
        ? {
            key: "run",
            label: input.isRunning ? "Starting..." : "Run in Bob",
            disabled: input.isRunning,
          }
        : { key: "none", label: "", disabled: true },
      error,
    };
  }

  if (input.isLoading && input.drafts.length === 0) {
    return {
      phase: "loading",
      title: "Tasks",
      detail: "Loading the plan...",
      drafts: [],
      batch: null,
      primaryAction: { key: "none", label: "", disabled: true },
      error,
    };
  }

  if (input.drafts.length === 0 && readyTasks.length > 0) {
    const starting = input.isRunning || input.isCreating;
    return {
      phase: "ready",
      title: "Tasks",
      detail: `${readyTasks.length} task${readyTasks.length === 1 ? "" : "s"} ready`,
      drafts: readyTasks.map((task) => ({
        id: task.draftId,
        title: task.title,
        description: null,
        meta: task.identifier,
        blockedBy: [],
      })),
      batch: null,
      primaryAction: {
        key: "run",
        label: starting ? "Starting..." : "Run in Bob",
        disabled: starting,
      },
      error,
    };
  }

  if (input.drafts.length === 0) {
    return {
      phase: "empty",
      title: "Tasks",
      detail: "Bob adds tasks here as the plan takes shape.",
      drafts: [],
      batch: null,
      primaryAction: { key: "none", label: "", disabled: true },
      error,
    };
  }

  const countLabel = `${input.drafts.length} task${input.drafts.length === 1 ? "" : "s"} ready`;
  return {
    phase: "drafts",
    title: "Tasks",
    detail: countLabel,
    drafts: [...input.drafts],
    batch: null,
    primaryAction: {
      key: "create",
      label: input.isCreating ? "Creating..." : "Create tasks",
      disabled: input.isCreating,
    },
    error,
  };
}

function priorityLabel(priority: string | null): string | null {
  if (!priority || HIDDEN_PRIORITIES.has(priority)) return null;
  return formatPlanLabel(priority);
}

function taskStatusTone(status: string): PlanStatusTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running" || status === "blocked" || status === "dispatching") {
    return "warning";
  }
  return "default";
}

function batchStatusTone(status: string, failed: number): PlanStatusTone {
  if (status === "failed" || failed > 0) return "danger";
  if (status === "completed") return "success";
  if (status === "running" || status === "dispatching") return "warning";
  return "default";
}

function countStatus(items: readonly { status: string }[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

function buildProgressLabel(
  items: readonly { status: string }[],
  total: number,
  completed: number,
  failed: number,
): string {
  const running = countStatus(items, "running");
  const waiting = items.filter(
    (item) => item.status === "queued" || item.status === "blocked",
  ).length;
  const parts = [
    total > 0 ? `${total} task${total === 1 ? "" : "s"}` : null,
    running > 0 ? `${running} running` : null,
    waiting > 0 ? `${waiting} waiting` : null,
    completed > 0 ? `${completed} done` : null,
    failed > 0 ? `${failed} failed` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ") || "No tasks";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}
