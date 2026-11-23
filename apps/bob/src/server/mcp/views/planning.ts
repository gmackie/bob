// Planning review model for ui://bob/planning-review.html, from Bob work items and runs.
import type { BobRun, BobWorkItem, RunSummary, WorkItem } from "./types";

export type PlanningWorkflowModel = {
  readonly pluginId: string;
  readonly workflowId: string;
  readonly title: string;
  readonly currentStage: "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond";
  readonly refreshedAt: string;
  readonly steps: readonly { id: string; stage: PlanningWorkflowModel["currentStage"]; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[];
  readonly evidence?: readonly { id: string; title: string; kind: "check" | "artifact" | "diff" | "log" | "link"; status: "neutral" | "positive" | "warning" | "negative"; detail?: string }[];
  readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[];
};

type PlanningState = { readonly approved?: boolean; readonly dispatchRequested?: boolean };

// An existing run is evidence of execution, never evidence of human approval.
// This review authorizes a first dispatch; retries need a separately reviewed plan.
export function planningDispatchBlocker(item: WorkItem, runs: readonly RunSummary[], state: PlanningState = {}): string | undefined {
  if (item.status.category === "done" || item.status.category === "cancelled") return `Bob work item is ${item.status.label}; dispatch is unavailable`;
  if (runs.length) return "Bob work item already has run evidence; review the existing run before planning another attempt";
  if (state.dispatchRequested) return "Bob dispatch was already requested; refresh the existing run evidence";
}

export function buildPlanningWorkflow(item: WorkItem, runs: readonly RunSummary[], state: PlanningState = {}): PlanningWorkflowModel {
  const latestRun = runs[0];
  const failed = latestRun?.status === "failed";
  const blocker = planningDispatchBlocker(item, runs, state);
  const dispatched = Boolean(latestRun || state.dispatchRequested);
  const approvalDetail = blocker && !state.approved ? "Prior authorization is unknown; no approval is recorded in Bob." : undefined;
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect Bob work item", state: "completed" as const, detail: item.title },
    { id: "context", stage: "context" as const, title: "Collect planning and run context", state: "completed" as const, detail: `${runs.length} associated runs` },
    { id: "propose", stage: "propose" as const, title: "Propose execution target", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review dispatch plan", state: state.approved ? "completed" as const : blocker ? "blocked" as const : "active" as const },
    { id: "approve", stage: "approve" as const, title: "Approve Bob dispatch", state: state.approved ? "completed" as const : blocker ? "blocked" as const : "pending" as const, ...(approvalDetail ? { detail: approvalDetail } : {}) },
    { id: "execute", stage: "execute" as const, title: "Dispatch work item", state: dispatched ? "completed" as const : blocker ? "blocked" as const : state.approved ? "active" as const : "pending" as const },
    { id: "verify", stage: "verify" as const, title: "Verify Bob run", state: latestRun?.status === "succeeded" ? "completed" as const : failed ? "failed" as const : latestRun?.status === "cancelled" ? "blocked" as const : dispatched ? "active" as const : blocker ? "blocked" as const : "pending" as const, detail: latestRun ? `Latest run ${latestRun.id}: ${latestRun.status}` : blocker ?? "Waiting for dispatch" },
    { id: "respond", stage: "respond" as const, title: "Prepare work-item response", state: "pending" as const },
  ];
  return {
    pluginId: "com.t3code.bob",
    workflowId: "bob.planning-review",
    title: "Planning review",
    currentStage: blocker ? "verify" : state.approved ? "execute" : "review",
    refreshedAt: new Date().toISOString(),
    steps,
    evidence: [
      { id: "bob-run", title: "Bob run state", kind: "check", status: failed ? "negative" : latestRun?.status === "succeeded" ? "positive" : "neutral", detail: latestRun ? `${latestRun.id} · ${latestRun.status}` : "No run evidence available" },
      ...(approvalDetail ? [{ id: "bob-approval", title: "Dispatch authorization", kind: "check" as const, status: "warning" as const, detail: approvalDetail }] : []),
    ],
    actions: blocker ? [] : state.approved ? [{ id: "execute", title: "Dispatch work item", tone: "primary" }] : [{ id: "approve", title: "Approve Bob dispatch", tone: "primary" }],
  };
}

const statusCategory = (status: string): WorkItem["status"]["category"] => {
  const value = status.toLowerCase();
  if (value.includes("done") || value.includes("complete")) return "done";
  if (value.includes("block")) return "blocked";
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("progress") || value.includes("active") || value.includes("run")) return "active";
  return "backlog";
};

export function normalizeBobWorkItem(item: BobWorkItem): WorkItem {
  return {
    providerId: "bob",
    id: item.id,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.url ? { url: item.url } : {}),
    status: { id: item.status, label: item.status, category: statusCategory(item.status) },
    scope: item.projectId ? { projectId: item.projectId } : {},
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}

export function normalizeBobRun(run: BobRun): RunSummary {
  const status = statusCategory(run.status);
  const failed = /fail|error/i.test(run.status);
  return {
    providerId: "bob",
    id: run.id,
    status: failed ? "failed" : status === "done" ? "succeeded" : status === "cancelled" ? "cancelled" : status === "active" ? "running" : "queued",
    ...(run.workItemId ? { workItemId: run.workItemId } : {}),
    ...(run.threadId ? { threadId: run.threadId } : {}),
    ...(run.agentType ? { agentType: run.agentType } : {}),
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.createdAt ? { createdAt: run.createdAt } : {}),
  };
}
