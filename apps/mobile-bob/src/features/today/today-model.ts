/**
 * Today, as a person reads it.
 *
 * The server's daily plan is a record: items, intake counts, a review. This
 * turns it into the three things the screen has to answer at a glance: what
 * is the state of the day (waiting on my approval, in progress, reviewed),
 * how far along is it, and what do I need to do next. Pure so it can be
 * tested without a runtime, and shared by the phone screen and the tablet
 * pane so the two cannot disagree about the day.
 */

import type { SessionSummaryTone } from "~/features/sessions/session-summary-model";
import { formatStatusLabel } from "~/features/tablet/queue";

export type DailyPlanStatus = "draft" | "approved" | "closed";
export type DailyPlanOutcome =
  | "done"
  | "in_review"
  | "running"
  | "blocked"
  | "failed"
  | "not_started"
  | "other";

export interface DailyPlanItemInput {
  workItemId: string;
  title: string;
  identifier: string | null;
  projectId: string | null;
  projectName: string | null;
  objective: string;
  source: "queue" | "bizpulse" | "carryover";
  statusAtPlan: string;
  order: number;
  currentStatus?: string | null;
}

export interface DailyPlanIntakeInput {
  provider: string;
  pulled: number;
  created: number;
  reused: number;
  skipped: number;
  error: string | null;
}

export interface DailyPlanReviewInput {
  items: readonly {
    workItemId: string;
    title: string;
    identifier: string | null;
    outcome: DailyPlanOutcome;
    status: string;
    sessionIds: readonly string[];
  }[];
  counts: Record<string, number>;
  unplannedSessionIds: readonly string[];
  sessionsCompleted: number;
  sessionsFailed: number;
  sessionsBlocked: number;
  generatedAt: string;
}

export interface DailyPlanInput {
  id: string;
  workspaceId: string;
  planDate: string;
  status: DailyPlanStatus;
  summary: string;
  items: readonly DailyPlanItemInput[];
  intake: readonly DailyPlanIntakeInput[];
  review: DailyPlanReviewInput | null;
  reviewSummary: string | null;
  capacity: number;
  createdAt: string;
  approvedAt: string | null;
  closedAt: string | null;
}

export interface TodayItemRow {
  workItemId: string;
  title: string;
  identifier: string | null;
  projectName: string | null;
  objective: string;
  source: DailyPlanItemInput["source"];
  sourceLabel: string | null;
  status: string;
  statusLabel: string;
  outcome: DailyPlanOutcome;
  tone: SessionSummaryTone;
  href: string;
}

export interface TodayProgress {
  total: number;
  finished: number;
  running: number;
  blocked: number;
  failed: number;
  notStarted: number;
  /** 0..1, finished over total. */
  fraction: number;
  label: string;
}

export interface TodayReviewSection {
  title: string;
  outcome: DailyPlanOutcome;
  rows: {
    workItemId: string;
    title: string;
    identifier: string | null;
    sessionIds: readonly string[];
    href: string;
  }[];
}

export interface TodayView {
  planId: string;
  dateLabel: string;
  status: DailyPlanStatus;
  statusLabel: string;
  tone: SessionSummaryTone;
  headline: string;
  summary: string;
  intakeLabel: string | null;
  intakeError: string | null;
  items: TodayItemRow[];
  progress: TodayProgress;
  canApprove: boolean;
  canClose: boolean;
  canRegenerate: boolean;
  review: {
    summary: string;
    sections: TodayReviewSection[];
    unplannedSessionIds: readonly string[];
    sessionsLabel: string;
  } | null;
}

const DONE = new Set(["done", "completed"]);
const REVIEW = new Set(["in_review", "review"]);
const RUNNING = new Set(["in_progress", "running"]);
const BLOCKED = new Set(["blocked"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);
const NOT_STARTED = new Set(["todo", "ready", "backlog", "draft", "planned"]);

export function outcomeForStatus(status: string): DailyPlanOutcome {
  const s = status.toLowerCase();
  if (DONE.has(s)) return "done";
  if (REVIEW.has(s)) return "in_review";
  if (RUNNING.has(s)) return "running";
  if (BLOCKED.has(s)) return "blocked";
  if (FAILED.has(s)) return "failed";
  if (NOT_STARTED.has(s)) return "not_started";
  return "other";
}

const OUTCOME_TONE: Record<DailyPlanOutcome, SessionSummaryTone> = {
  done: "success",
  in_review: "attention",
  running: "running",
  blocked: "attention",
  failed: "failure",
  not_started: "idle",
  other: "idle",
};

const OUTCOME_LABEL: Record<DailyPlanOutcome, string> = {
  done: "Done",
  in_review: "Review",
  running: "Running",
  blocked: "Blocked",
  failed: "Failed",
  not_started: "Queued",
  other: "Other",
};

const SOURCE_LABEL: Record<DailyPlanItemInput["source"], string | null> = {
  queue: null,
  bizpulse: "BizPulse",
  carryover: "Carried over",
};

const REVIEW_SECTIONS: { title: string; outcome: DailyPlanOutcome }[] = [
  { title: "Needs your review", outcome: "in_review" },
  { title: "Done", outcome: "done" },
  { title: "Blocked", outcome: "blocked" },
  { title: "Failed", outcome: "failed" },
  { title: "Still running", outcome: "running" },
  { title: "Not started", outcome: "not_started" },
];

export function formatPlanDate(planDate: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (planDate === today) return "Today";
  const yesterday = new Date(now.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (planDate === yesterday) return "Yesterday";
  const parsed = new Date(`${planDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return planDate;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function workItemHref(workItemId: string, outcome: DailyPlanOutcome): string {
  const view =
    outcome === "done" || outcome === "in_review" || outcome === "failed"
      ? "outcome"
      : "queue";
  return `/work-items/${encodeURIComponent(workItemId)}?view=${view}`;
}

export function buildTodayProgress(
  items: readonly { outcome: DailyPlanOutcome }[],
): TodayProgress {
  const total = items.length;
  let finished = 0;
  let running = 0;
  let blocked = 0;
  let failed = 0;
  let notStarted = 0;
  for (const item of items) {
    if (item.outcome === "done" || item.outcome === "in_review") finished += 1;
    else if (item.outcome === "running") running += 1;
    else if (item.outcome === "blocked") blocked += 1;
    else if (item.outcome === "failed") failed += 1;
    else notStarted += 1;
  }
  const fraction = total === 0 ? 0 : finished / total;
  const label =
    total === 0
      ? "Nothing planned"
      : [
          `${finished} of ${total} finished`,
          running > 0 ? `${running} running` : null,
          blocked > 0 ? `${blocked} blocked` : null,
          failed > 0 ? `${failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return {
    total,
    finished,
    running,
    blocked,
    failed,
    notStarted,
    fraction,
    label,
  };
}

function intakeLabel(intake: readonly DailyPlanIntakeInput[]): string | null {
  const parts = intake
    .filter((i) => !i.error)
    .map((i) => {
      const name =
        i.provider === "bizpulse" ? "BizPulse" : formatStatusLabel(i.provider);
      if (i.pulled === 0) return `${name}: nothing new`;
      return `${name}: ${i.created} new, ${i.reused} recurring, ${i.skipped} already in`;
    });
  return parts.length ? parts.join(" · ") : null;
}

export function buildTodayView(
  plan: DailyPlanInput,
  options: { now?: Date } = {},
): TodayView {
  const now = options.now ?? new Date();
  const items: TodayItemRow[] = [...plan.items]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const status = item.currentStatus ?? item.statusAtPlan;
      const outcome = outcomeForStatus(status);
      return {
        workItemId: item.workItemId,
        title: item.title,
        identifier: item.identifier,
        projectName: item.projectName,
        objective: item.objective,
        source: item.source,
        sourceLabel: SOURCE_LABEL[item.source],
        status,
        statusLabel: OUTCOME_LABEL[outcome],
        outcome,
        tone: OUTCOME_TONE[outcome],
        href: workItemHref(item.workItemId, outcome),
      };
    });
  const progress = buildTodayProgress(items);

  let tone: SessionSummaryTone;
  let statusLabel: string;
  let headline: string;
  if (plan.status === "draft") {
    tone = "attention";
    statusLabel = "Waiting for approval";
    headline =
      items.length === 0
        ? "Nothing to plan today; the queue is empty."
        : `${items.length} item${items.length === 1 ? "" : "s"} proposed. Approve to set today's order.`;
  } else if (plan.status === "approved") {
    tone =
      progress.blocked > 0 || progress.failed > 0 ? "attention" : "running";
    statusLabel = "In progress";
    headline = progress.label;
  } else {
    tone =
      progress.failed > 0
        ? "failure"
        : progress.finished === progress.total
          ? "success"
          : "idle";
    statusLabel = "Reviewed";
    headline = plan.reviewSummary?.split("\n")[0] ?? progress.label;
  }

  const intakeErrors = plan.intake
    .filter((i) => i.error)
    .map((i) => `${i.provider}: ${i.error}`);

  const planReview = plan.review;
  const review = planReview
    ? {
        summary: plan.reviewSummary ?? "",
        sections: REVIEW_SECTIONS.map((section) => ({
          ...section,
          rows: planReview.items
            .filter((i) => i.outcome === section.outcome)
            .map((i) => ({
              workItemId: i.workItemId,
              title: i.title,
              identifier: i.identifier,
              sessionIds: i.sessionIds,
              href: workItemHref(i.workItemId, i.outcome),
            })),
        })).filter((section) => section.rows.length > 0),
        unplannedSessionIds: planReview.unplannedSessionIds,
        sessionsLabel: `${planReview.sessionsCompleted} completed · ${planReview.sessionsFailed} failed · ${planReview.sessionsBlocked} blocked`,
      }
    : null;

  return {
    planId: plan.id,
    dateLabel: formatPlanDate(plan.planDate, now),
    status: plan.status,
    statusLabel,
    tone,
    headline,
    summary: plan.summary,
    intakeLabel: intakeLabel(plan.intake),
    intakeError: intakeErrors.length ? intakeErrors.join("; ") : null,
    items,
    progress,
    canApprove: plan.status === "draft" && items.length > 0,
    canClose: plan.status === "approved",
    canRegenerate: plan.status === "draft",
    review,
  };
}
