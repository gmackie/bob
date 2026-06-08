export type WorkItemEntryView = "planning" | "queue" | "outcome";

export interface WorkItemEntryFact {
  label: string;
  value: string;
}

export type WorkItemEntrySectionKey =
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

export interface WorkItemEntrySection {
  key: WorkItemEntrySectionKey;
  label: string;
}

export interface WorkItemEntryBreadcrumb {
  label: string;
  href?: string;
}

export interface WorkItemEntryProjectBreadcrumb {
  id: string;
  key: string;
}

export interface WorkItemEntryRelatedWorkItem {
  id: string;
  identifier: string;
  title: string;
  status: string;
}

export interface WorkItemEntryRelatedWorkItemSummary extends WorkItemEntryRelatedWorkItem {
  statusLabel: string;
}

export interface WorkItemEntryDependencySummary {
  dependencies: WorkItemEntryRelatedWorkItemSummary[];
  dependents: WorkItemEntryRelatedWorkItemSummary[];
  dependencyStatus: string;
  dependentStatus: string;
}

export interface WorkItemEntryArtifactSummary {
  id: string;
  artifactRole?: string | null;
  artifactType?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WorkItemEntryProjectSummary {
  id: string;
  key?: string | null;
  name?: string | null;
}

export interface WorkItemEntryValidationState {
  label: string;
  detail: string;
  tone: "default" | "positive" | "warning" | "critical";
}

export interface WorkItemEntryContext {
  view: WorkItemEntryView;
  label: string;
  heading: string;
  description: string;
  backHref: string;
  workspaceId?: string | null;
  facts: WorkItemEntryFact[];
  sections: WorkItemEntrySection[];
  dependencySummary?: WorkItemEntryDependencySummary;
}

export interface WorkItemEntryWorkItem {
  kind: string;
  status?: string | null;
  priority?: string | null;
  queueSortOrder?: number | null;
  agentStatus?: WorkItemEntryAgentStatus | null;
  project?: WorkItemEntryProjectSummary | null;
  dependencies?: WorkItemEntryRelatedWorkItem[] | null;
  dependents?: WorkItemEntryRelatedWorkItem[] | null;
}

export interface WorkItemEntryAgentStatus {
  sessionId: string;
  status: string;
  agentType?: string | null;
}

export interface WorkItemOutcomeRun {
  id: string;
  sessionId?: string | null;
  status?: string | null;
  agentType?: string | null;
  createdAt?: string | Date | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface WorkItemEntryRunRow {
  id: string;
  label: string;
  statusLabel: string;
  runHref: string;
  sessionHref: string | null;
  primaryHref: string;
  primaryActionLabel: "Open session" | "Open run";
}

export type WorkItemEntryAction =
  | { kind: "dispatch"; label: "Start work" }
  | { kind: "rerun"; label: "Rerun work" }
  | {
      kind: "live-session";
      label: "Open live session";
      href: string;
      sessionId: string;
    }
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

const QUEUE_DETAIL_SECTIONS: WorkItemEntrySection[] = [
  { key: "task-summary", label: "Task summary" },
  { key: "priority-queue", label: "Priority and queue" },
  { key: "dependencies-blockers", label: "Dependencies and blockers" },
  { key: "project-context", label: "Project context" },
  { key: "dispatch-controls", label: "Dispatch controls" },
  { key: "linked-sessions", label: "Linked sessions" },
  { key: "artifacts-validation", label: "Artifacts and validation" },
];

const OUTCOME_DETAIL_SECTIONS: WorkItemEntrySection[] = [
  { key: "outcome-summary", label: "Outcome summary" },
  { key: "provider-agent", label: "Provider and agent" },
  { key: "timeline-events", label: "Timeline and events" },
  { key: "readable-output", label: "Readable output" },
  { key: "artifacts", label: "Artifacts" },
  { key: "validation-review", label: "Validation and review" },
  { key: "follow-up-controls", label: "Follow-up controls" },
  { key: "linked-task", label: "Linked task" },
];

const PLANNING_DETAIL_SECTIONS: WorkItemEntrySection[] = [
  { key: "scope", label: "Scope" },
  { key: "project-context", label: "Project context" },
  { key: "discussion", label: "Discussion" },
  { key: "artifacts", label: "Artifacts" },
  { key: "planning-history", label: "Planning history" },
];

export function normalizeWorkItemEntryView(value: string | null): WorkItemEntryView {
  return value === "queue" || value === "outcome" ? value : "planning";
}

export function buildWorkItemEntryContext(input: {
  view: WorkItemEntryView;
  workspaceId?: string | null;
  workItem: WorkItemEntryWorkItem;
}): WorkItemEntryContext {
  if (input.view === "queue" && input.workItem.kind === "task") {
    const dependencySummary = buildDependencySummary(input.workItem);
    return {
      view: "queue",
      label: "Priority Queue",
      heading: "Task-forward detail",
      description:
        "Review priority, queue position, dependencies, and dispatch controls before starting work.",
      backHref: getWorkspaceScopedHref("/tasks/queue", input.workspaceId),
      workspaceId: input.workspaceId,
      facts: [
        { label: "Priority", value: formatLabel(input.workItem.priority ?? "no_priority") },
        { label: "Queue", value: String(input.workItem.queueSortOrder ?? "Unordered") },
        ...getProjectContextFacts(input.workItem.project),
        { label: "Dependencies", value: dependencySummary.dependencyStatus },
        { label: "Blocking", value: dependencySummary.dependentStatus },
      ],
      sections: QUEUE_DETAIL_SECTIONS,
      dependencySummary,
    };
  }

  if (input.view === "outcome") {
    const outcomeStatus = getAuthoritativeOutcomeStatus(input.workItem);
    const facts: WorkItemEntryFact[] = [
      { label: "Status", value: formatLabel(outcomeStatus) },
      ...getOutcomeAgentFacts(input.workItem),
    ];

    return {
      view: "outcome",
      label: "Recent Outcomes",
      heading: "Session-forward detail",
      description:
        "Review the latest session outcome, readable output, artifacts, and follow-up controls.",
      backHref: getWorkspaceScopedHref("/runs", input.workspaceId),
      workspaceId: input.workspaceId,
      facts,
      sections: OUTCOME_DETAIL_SECTIONS,
    };
  }

  return {
    view: "planning",
    label: "Planning",
    heading: "Work item detail",
    description:
      "Review scope, project context, discussion, artifacts, and planning history.",
    backHref: getWorkspaceScopedHref("/planning", input.workspaceId),
    workspaceId: input.workspaceId,
    facts: [{ label: "Status", value: formatLabel(input.workItem.status ?? "unknown") }],
    sections: PLANNING_DETAIL_SECTIONS,
  };
}

function getWorkspaceScopedHref(
  pathname: "/tasks/queue" | "/runs" | "/planning" | `/projects/${string}`,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return pathname;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `${pathname}?${params.toString()}`;
}

export function getWorkItemEntryBreadcrumbs(input: {
  context: WorkItemEntryContext;
  identifier: string;
  project?: WorkItemEntryProjectBreadcrumb | null;
  workspaceId?: string | null;
}): WorkItemEntryBreadcrumb[] {
  return [
    { label: input.context.label, href: input.context.backHref },
    ...(input.project
      ? [
          {
            label: input.project.key,
            href: getWorkspaceScopedHref(`/projects/${input.project.id}`, input.workspaceId),
          },
        ]
      : []),
    { label: input.identifier },
  ];
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getWorkItemEntryRelatedQueueHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}?view=queue`, workspaceId);
}

export function getWorkItemEntryHref(
  workItemId: string,
  view: WorkItemEntryView = "planning",
  workspaceId?: string | null,
): string {
  const path =
    view === "planning"
      ? `/work-items/${workItemId}`
      : `/work-items/${workItemId}?view=${view}`;

  return appendWorkspaceParam(path, workspaceId);
}

export function getWorkItemEntryPlanSessionHref(
  workItemId: string,
  sessionId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}/plan/${sessionId}`, workspaceId);
}

export function getWorkItemReviewHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}/review`, workspaceId);
}

export function getWorkItemEntryAction(input: {
  view: WorkItemEntryView;
  workspaceId?: string | null;
  workItem: WorkItemEntryWorkItem;
}): WorkItemEntryAction {
  const outcomeStatus = getAuthoritativeOutcomeStatus(input.workItem);

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
      href: getWorkItemOutcomeSessionHref(agentStatus.sessionId, input.workspaceId),
      sessionId: agentStatus.sessionId,
    };
  }

  if (DISPATCHABLE_STATUSES.has(input.workItem.status ?? "")) {
    return { kind: "dispatch", label: "Start work" };
  }

  return {
    kind: "none",
    label: "No task action",
    reason: "This task is not ready to dispatch from the queue.",
  };
}

function getAuthoritativeOutcomeStatus(workItem: WorkItemEntryWorkItem): string {
  const status = workItem.status ?? "unknown";
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

function getOutcomeAgentFacts(workItem: WorkItemEntryWorkItem): WorkItemEntryFact[] {
  const agentStatus = workItem.agentStatus;
  if (!agentStatus) return [];

  return [
    ...(agentStatus.agentType
      ? [{ label: "Provider", value: formatLabel(agentStatus.agentType) }]
      : []),
    ...(agentStatus.sessionId
      ? [{ label: "Session", value: agentStatus.sessionId }]
      : []),
  ];
}

function getProjectContextFacts(
  project?: WorkItemEntryProjectSummary | null,
): WorkItemEntryFact[] {
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
  artifact: WorkItemEntryArtifactSummary,
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

export function getWorkItemEntryValidationState(
  artifacts: WorkItemEntryArtifactSummary[],
): WorkItemEntryValidationState {
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

export function selectLatestSessionBackedOutcomeRun<T extends WorkItemOutcomeRun>(
  runs: T[],
): T | null {
  const candidates = runs.filter((run) => Boolean(run.sessionId));
  if (candidates.length === 0) return null;

  return [...candidates].sort((left, right) => runTime(right) - runTime(left))[0] ?? null;
}

export function buildWorkItemEntryRunRows<T extends WorkItemOutcomeRun>(
  runs: T[],
  workspaceId?: string | null,
): WorkItemEntryRunRow[] {
  return [...runs]
    .sort((left, right) => runTime(right) - runTime(left))
    .map((run) => {
      const runHref = getWorkItemRunHref(run.id, workspaceId);
      const sessionHref = run.sessionId
        ? getWorkItemOutcomeSessionHref(run.sessionId, workspaceId)
        : null;

      return {
        id: run.id,
        label: `${formatLabel(run.agentType ?? "agent")} run`,
        statusLabel: formatLabel(run.status ?? "recorded"),
        runHref,
        sessionHref,
        primaryHref: sessionHref ?? runHref,
        primaryActionLabel: sessionHref ? "Open session" : "Open run",
      };
    });
}

export function getWorkItemOutcomeSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return `/sessions/${sessionId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/sessions/${sessionId}?${params.toString()}`;
}

function getWorkItemRunHref(runId: string, workspaceId?: string | null): string {
  if (!workspaceId) return `/runs/${runId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/runs/${runId}?${params.toString()}`;
}

function runTime(run: WorkItemOutcomeRun): number {
  const value = run.completedAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function formatLabel(value: string): string {
  if (value === "no_priority") return "No Priority";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  workItem: WorkItemEntryWorkItem,
): WorkItemEntryDependencySummary {
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
  item: WorkItemEntryRelatedWorkItem,
): WorkItemEntryRelatedWorkItemSummary {
  return {
    ...item,
    statusLabel: formatLabel(item.status),
  };
}
