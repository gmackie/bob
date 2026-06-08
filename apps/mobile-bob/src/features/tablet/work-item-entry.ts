import { extractSessionEventText } from "../chat/session-event-text";
import {
  formatStatusLabel,
  type TabletQueueAgentStatus,
  type TabletQueueItem,
} from "./queue";

export type MobileWorkItemEntryView = "queue" | "outcome" | "planning";

export interface MobileWorkItemEntryFact {
  label: string;
  value: string;
}

export type MobileWorkItemEntrySectionKey =
  | "task-summary"
  | "priority-queue"
  | "dependencies-blockers"
  | "project-context"
  | "dispatch-controls"
  | "linked-sessions"
  | "artifacts-validation"
  | "outcome-summary"
  | "provider-agent"
  | "timeline-events"
  | "readable-output"
  | "artifacts"
  | "validation-review"
  | "follow-up-controls"
  | "linked-task"
  | "scope"
  | "discussion"
  | "planning-history";

export interface MobileWorkItemEntrySection {
  key: MobileWorkItemEntrySectionKey;
  label: string;
}

export interface MobileWorkItemEntryRelatedWorkItem {
  id: string;
  identifier: string;
  title: string;
  status: string;
}

export interface MobileWorkItemEntryRelatedWorkItemSummary
  extends MobileWorkItemEntryRelatedWorkItem {
  statusLabel: string;
}

export interface MobileWorkItemEntryDependencySummary {
  dependencies: MobileWorkItemEntryRelatedWorkItemSummary[];
  dependents: MobileWorkItemEntryRelatedWorkItemSummary[];
  dependencyStatus: string;
  dependentStatus: string;
}

export interface MobileWorkItemEntryProjectSummary {
  id: string;
  key?: string | null;
  name?: string | null;
}

export interface MobileWorkItemEntryArtifactSummary {
  id: string;
  artifactRole?: string | null;
  artifactType?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MobileWorkItemEntryValidationState {
  label: string;
  detail: string;
  tone: "default" | "positive" | "warning" | "critical";
}

export interface MobileWorkItemEntryContext {
  sourceLabel: string;
  heading: string;
  description: string;
  backLabel: string;
  facts: MobileWorkItemEntryFact[];
  sections: MobileWorkItemEntrySection[];
  dependencySummary?: MobileWorkItemEntryDependencySummary;
}

export interface MobileWorkItemEntrySourceItem {
  id: string;
  identifier?: string | null;
  title: string;
  kind: string;
  status: string;
  priority?: string | null;
  queueSortOrder?: number | null;
  updatedAt?: string | Date | null;
  completedAt?: string | Date | null;
  agentStatus?: TabletQueueAgentStatus | null;
  project?: MobileWorkItemEntryProjectSummary | null;
  dependencies?: MobileWorkItemEntryRelatedWorkItem[] | null;
  dependents?: MobileWorkItemEntryRelatedWorkItem[] | null;
}

export type MobileWorkItemEntryItem = TabletQueueItem & {
  dependencies?: MobileWorkItemEntryRelatedWorkItem[] | null;
  dependents?: MobileWorkItemEntryRelatedWorkItem[] | null;
};

export interface MobileWorkItemOutcomeRun {
  id: string;
  sessionId?: string | null;
  status?: string | null;
  agentType?: string | null;
  createdAt?: string | Date | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface MobileWorkItemEntryRunRow {
  id: string;
  label: string;
  statusLabel: string;
  runHref: string;
  sessionHref: string | null;
  primaryHref: string;
  primaryActionLabel: "Open session" | "Open run";
}

export interface MobileReadableOutcomeEvent {
  seq: number;
  eventType: string;
  direction: string;
  payload: Record<string, unknown>;
}

export interface MobileReadableOutcomeRow {
  id: string;
  label: string;
  text: string;
}

export type MobileWorkItemEntryAction =
  | { kind: "dispatch"; label: "Start work" }
  | { kind: "rerun"; label: "Rerun work" }
  | { kind: "live-session"; label: "Open live session"; sessionId: string; href: string }
  | { kind: "none"; label: "No task action"; reason: string };

const DISPATCHABLE_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const RERUNNABLE_OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "error",
  "failed",
  "interrupted",
  "stopped",
]);
const REVIEW_OUTCOME_STATUSES = new Set(["in_review", "review"]);
const WORK_ITEM_OUTCOME_STATUSES = new Set([
  ...RERUNNABLE_OUTCOME_STATUSES,
  ...REVIEW_OUTCOME_STATUSES,
]);
const ACTIVE_AGENT_STATUSES = new Set([
  "running",
  "starting",
  "provisioning",
  "queued",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);

const QUEUE_DETAIL_SECTIONS: MobileWorkItemEntrySection[] = [
  { key: "task-summary", label: "Task summary" },
  { key: "priority-queue", label: "Priority and queue" },
  { key: "dependencies-blockers", label: "Dependencies and blockers" },
  { key: "project-context", label: "Project context" },
  { key: "dispatch-controls", label: "Dispatch controls" },
  { key: "linked-sessions", label: "Linked sessions" },
  { key: "artifacts-validation", label: "Artifacts and validation" },
];

const OUTCOME_DETAIL_SECTIONS: MobileWorkItemEntrySection[] = [
  { key: "outcome-summary", label: "Outcome summary" },
  { key: "provider-agent", label: "Provider and agent" },
  { key: "timeline-events", label: "Timeline and events" },
  { key: "readable-output", label: "Readable output" },
  { key: "artifacts", label: "Artifacts" },
  { key: "validation-review", label: "Validation and review" },
  { key: "follow-up-controls", label: "Follow-up controls" },
  { key: "linked-task", label: "Linked task" },
];

const PLANNING_DETAIL_SECTIONS: MobileWorkItemEntrySection[] = [
  { key: "scope", label: "Scope" },
  { key: "project-context", label: "Project context" },
  { key: "discussion", label: "Discussion" },
  { key: "artifacts", label: "Artifacts" },
  { key: "planning-history", label: "Planning history" },
];

export function normalizeMobileWorkItemEntryView(
  value: string | string[] | undefined,
): MobileWorkItemEntryView {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "queue" || raw === "outcome" || raw === "planning") {
    return raw;
  }
  return "planning";
}

export function buildMobileWorkItemEntryItem(
  workItem: MobileWorkItemEntrySourceItem,
): MobileWorkItemEntryItem {
  return {
    id: workItem.id,
    identifier: workItem.identifier ?? "",
    title: workItem.title,
    kind: workItem.kind,
    status: workItem.status,
    priority: workItem.priority,
    queueSortOrder: workItem.queueSortOrder,
    updatedAt: workItem.updatedAt,
    completedAt: workItem.completedAt,
    agentStatus: workItem.agentStatus,
    project: workItem.project,
    dependencies: workItem.dependencies,
    dependents: workItem.dependents,
  };
}

export function buildMobileWorkItemEntryContext({
  view,
  workItem,
}: {
  view: MobileWorkItemEntryView;
  workItem: TabletQueueItem & {
    dependencies?: MobileWorkItemEntryRelatedWorkItem[] | null;
    dependents?: MobileWorkItemEntryRelatedWorkItem[] | null;
  };
}): MobileWorkItemEntryContext {
  if (view === "queue" && workItem.kind === "task") {
    const dependencySummary = buildDependencySummary(workItem);
    return {
      sourceLabel: "Priority Queue",
      heading: "Task-forward detail",
      description:
        "Review priority, queue position, dependencies, and dispatch controls before starting work.",
      backLabel: "Priority Queue",
      facts: [
        { label: "Priority", value: workItem.priority ?? "none" },
        {
          label: "Queue",
          value:
            typeof workItem.queueSortOrder === "number"
              ? `#${workItem.queueSortOrder}`
            : "Unsorted",
        },
        ...getMobileProjectContextFacts(workItem.project),
        { label: "Dependencies", value: dependencySummary.dependencyStatus },
        { label: "Blocking", value: dependencySummary.dependentStatus },
      ],
      sections: QUEUE_DETAIL_SECTIONS,
      dependencySummary,
    };
  }

  if (view === "outcome") {
    const outcomeStatus = getAuthoritativeMobileOutcomeStatus(workItem);
    const facts: MobileWorkItemEntryFact[] = [
      { label: "Status", value: formatStatusLabel(outcomeStatus) },
      ...getMobileOutcomeAgentFacts(workItem),
    ];

    return {
      sourceLabel: "Recent Outcomes",
      heading: "Session-forward detail",
      description:
        "Review the latest session outcome, readable output, artifacts, and follow-up controls.",
      backLabel: "Recent Outcomes",
      facts,
      sections: OUTCOME_DETAIL_SECTIONS,
    };
  }

  return {
    sourceLabel: "Planning",
    heading: "Work item detail",
    description: "Review scope, project context, discussion, artifacts, and planning history.",
    backLabel: "Planning",
    facts: [{ label: "Status", value: formatStatusLabel(workItem.status) }],
    sections: PLANNING_DETAIL_SECTIONS,
  };
}

export function getMobileWorkItemEntryAction(input: {
  view: MobileWorkItemEntryView;
  workspaceId?: string | null;
  workItem: TabletQueueItem;
}): MobileWorkItemEntryAction {
  const outcomeStatus = getAuthoritativeMobileOutcomeStatus(input.workItem);

  if (
    input.view === "outcome" &&
    input.workItem.kind === "task" &&
    RERUNNABLE_OUTCOME_STATUSES.has(outcomeStatus)
  ) {
    return { kind: "rerun", label: "Rerun work" };
  }

  if (input.view !== "queue" || input.workItem.kind !== "task") {
    return {
      kind: "none",
      label: "No task action",
      reason: "Dispatch controls are only shown for task-forward queue details.",
    };
  }

  const agentStatus = input.workItem.agentStatus;
  if (
    agentStatus?.sessionId &&
    ACTIVE_AGENT_STATUSES.has(agentStatus.status)
  ) {
    return {
      kind: "live-session",
      label: "Open live session",
      sessionId: agentStatus.sessionId,
      href: getMobileSessionHref(agentStatus.sessionId, input.workspaceId),
    };
  }

  if (DISPATCHABLE_STATUSES.has(input.workItem.status)) {
    return { kind: "dispatch", label: "Start work" };
  }

  return {
    kind: "none",
    label: "No task action",
    reason: "This task is not ready to dispatch from the queue.",
  };
}

function getAuthoritativeMobileOutcomeStatus(workItem: TabletQueueItem): string {
  const status = workItem.status;
  const agentStatus = workItem.agentStatus?.status;

  if (
    !WORK_ITEM_OUTCOME_STATUSES.has(status) &&
    agentStatus &&
    RERUNNABLE_OUTCOME_STATUSES.has(agentStatus)
  ) {
    return agentStatus;
  }

  return status;
}

function getMobileOutcomeAgentFacts(workItem: TabletQueueItem): MobileWorkItemEntryFact[] {
  const agentStatus = workItem.agentStatus;
  if (!agentStatus) return [];

  return [
    ...(agentStatus.agentType
      ? [{ label: "Provider", value: formatStatusLabel(agentStatus.agentType) }]
      : []),
    ...(agentStatus.sessionId
      ? [{ label: "Session", value: agentStatus.sessionId }]
      : []),
  ];
}

function getMobileProjectContextFacts(
  project?: MobileWorkItemEntryProjectSummary | null,
): MobileWorkItemEntryFact[] {
  const key = project?.key?.trim();
  const name = project?.name?.trim();
  if (!key && !name) return [];

  return [
    {
      label: "Project",
      value: key && name ? `${key} · ${name}` : (key ?? name ?? "Unknown project"),
    },
  ];
}

function readArtifactResult(
  artifact: MobileWorkItemEntryArtifactSummary,
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

function nonEmptyOrFallback(
  value: string | null | undefined,
  fallback: string,
): string {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
}

export function getMobileWorkItemEntryValidationState(
  artifacts: MobileWorkItemEntryArtifactSummary[],
): MobileWorkItemEntryValidationState {
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
        detail: nonEmptyOrFallback(
          verificationArtifact.summary,
          "The latest verification run passed.",
        ),
        tone: "positive",
      };
    }

    if (result === "failed") {
      return {
        label: "Validation failed",
        detail: nonEmptyOrFallback(
          verificationArtifact.summary,
          "The latest verification run failed.",
        ),
        tone: "critical",
      };
    }

    return {
      label: "Validation in progress",
      detail: nonEmptyOrFallback(
        verificationArtifact.summary,
        "A verification artifact is attached, but it does not report a final result yet.",
      ),
      tone: "warning",
    };
  }

  const reviewArtifact = artifacts.find(
    (artifact) =>
      artifact.artifactRole === "review" ||
      artifact.artifactType === "pr",
  );

  if (reviewArtifact) {
    return {
      label: "Awaiting review",
      detail: "A review artifact is attached for the current handoff.",
      tone: "warning",
    };
  }

  return {
    label: "Validation not started",
    detail: "No verification or review artifact is attached to the current task yet.",
    tone: "default",
  };
}

export function selectLatestMobileSessionBackedOutcomeRun<T extends MobileWorkItemOutcomeRun>(
  runs: T[],
): T | null {
  const candidates = runs.filter((run) => Boolean(run.sessionId));
  if (candidates.length === 0) return null;

  return [...candidates].sort((left, right) => mobileRunTime(right) - mobileRunTime(left))[0] ?? null;
}

export function buildMobileWorkItemEntryRunRows<T extends MobileWorkItemOutcomeRun>(
  runs: T[],
  workspaceId?: string | null,
): MobileWorkItemEntryRunRow[] {
  return [...runs]
    .sort((left, right) => mobileRunTime(right) - mobileRunTime(left))
    .map((run) => {
      const runHref = appendWorkspaceParam(`/runs/${run.id}`, workspaceId);
      const sessionHref = run.sessionId
        ? appendWorkspaceParam(`/sessions/${run.sessionId}`, workspaceId)
        : null;

      return {
        id: run.id,
        label: `${formatStatusLabel(run.agentType ?? "agent")} run`,
        statusLabel: formatStatusLabel(run.status ?? "recorded"),
        runHref,
        sessionHref,
        primaryHref: sessionHref ?? runHref,
        primaryActionLabel: sessionHref ? "Open session" : "Open run",
      };
    });
}

export function buildMobileReadableOutcomeRows(
  events: MobileReadableOutcomeEvent[],
  limit = 6,
): MobileReadableOutcomeRow[] {
  return events
    .map((event) => ({
      id: `${event.seq}-${event.eventType}-${event.direction}`,
      label: getMobileReadableOutcomeEventLabel(event),
      text: extractSessionEventText(event.eventType, event.payload).trim(),
    }))
    .filter((row) => row.text.length > 0)
    .slice(-limit);
}

function mobileRunTime(run: MobileWorkItemOutcomeRun): number {
  const value = run.completedAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function getMobileReadableOutcomeEventLabel(event: MobileReadableOutcomeEvent): string {
  if (event.eventType === "tool_call") return "Tool Call";
  if (event.eventType === "tool_result") return "Tool Result";
  if (event.eventType === "error") return "Error";
  if (event.eventType === "state") return "State";
  if (event.direction === "user") return "You";
  return "Agent";
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getMobileQueueWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}?view=queue`, workspaceId);
}

export function getMobileOutcomeWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}?view=outcome`, workspaceId);
}

export function getMobileWorkItemDispatchSuccessHref(input: {
  workItemId: string;
  workspaceId?: string | null;
  result?: { sessionId?: unknown } | null;
}): string {
  const sessionId =
    typeof input.result?.sessionId === "string" && input.result.sessionId.trim()
      ? input.result.sessionId
      : null;

  if (sessionId) {
    return getMobileSessionHref(sessionId, input.workspaceId);
  }

  return appendWorkspaceParam(
    `/work-items/${input.workItemId}/workspace`,
    input.workspaceId,
  );
}

function getMobileSessionHref(sessionId: string, workspaceId?: string | null): string {
  if (!workspaceId) return `/sessions/${sessionId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/sessions/${sessionId}?${params.toString()}`;
}

const OPEN_DEPENDENCY_STATUSES = new Set([
  "backlog",
  "blocked",
  "draft",
  "error",
  "failed",
  "in_progress",
  "in_review",
  "interrupted",
  "ready",
  "review",
  "running",
  "todo",
]);

function buildDependencySummary(
  workItem: {
    dependencies?: MobileWorkItemEntryRelatedWorkItem[] | null;
    dependents?: MobileWorkItemEntryRelatedWorkItem[] | null;
  },
): MobileWorkItemEntryDependencySummary {
  const dependencies = (workItem.dependencies ?? []).map(formatRelatedWorkItem);
  const dependents = (workItem.dependents ?? []).map(formatRelatedWorkItem);
  const openDependencyCount = dependencies.filter((item) =>
    OPEN_DEPENDENCY_STATUSES.has(item.status),
  ).length;

  return {
    dependencies,
    dependents,
    dependencyStatus:
      dependencies.length === 0
        ? "No dependencies"
        : `${openDependencyCount} open / ${dependencies.length} total`,
    dependentStatus:
      dependents.length === 0
        ? "No blocked tasks"
        : `${dependents.length} ${dependents.length === 1 ? "task" : "tasks"}`,
  };
}

function formatRelatedWorkItem(
  item: MobileWorkItemEntryRelatedWorkItem,
): MobileWorkItemEntryRelatedWorkItemSummary {
  return {
    ...item,
    statusLabel: formatStatusLabel(item.status),
  };
}
