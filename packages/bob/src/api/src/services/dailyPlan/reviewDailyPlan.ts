/**
 * The evening review: the plan, item by item, against what happened.
 *
 * The digest counts sessions and PRs across the whole system; it cannot say
 * whether the day went to plan, because until now there was no plan. This
 * takes the morning's items and the day's sessions and answers the only
 * question a person has at the end of the day: of what we said we would do,
 * what got done, what is waiting on me, and what slipped.
 *
 * Pure; the handler supplies the current work item rows and the sessions.
 */

import type {
  DailyPlanItem,
  DailyPlanReview,
  DailyPlanReviewItem,
} from "@bob/db/schema";

export interface ReviewWorkItemState {
  workItemId: string;
  status: string;
}

export interface ReviewSession {
  sessionId: string;
  workItemId: string | null;
  status: string;
}

export interface ReviewDailyPlanInput {
  items: readonly DailyPlanItem[];
  workItems: readonly ReviewWorkItemState[];
  /** Execution sessions created today in the workspace. */
  sessions: readonly ReviewSession[];
  now?: Date;
}

const DONE = new Set(["done", "completed"]);
const REVIEW = new Set(["in_review", "review"]);
const RUNNING = new Set(["in_progress", "running"]);
const BLOCKED = new Set(["blocked"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);
const NOT_STARTED = new Set(["todo", "ready", "backlog", "draft", "planned"]);

export function outcomeForStatus(
  status: string,
): DailyPlanReviewItem["outcome"] {
  const s = status.toLowerCase();
  if (DONE.has(s)) return "done";
  if (REVIEW.has(s)) return "in_review";
  if (RUNNING.has(s)) return "running";
  if (BLOCKED.has(s)) return "blocked";
  if (FAILED.has(s)) return "failed";
  if (NOT_STARTED.has(s)) return "not_started";
  return "other";
}

const SESSION_COMPLETED = new Set(["completed", "done"]);
const SESSION_FAILED = new Set(["failed", "error", "interrupted"]);
const SESSION_BLOCKED = new Set(["blocked", "host_unknown"]);

export function reviewDailyPlan(input: ReviewDailyPlanInput): DailyPlanReview {
  const now = input.now ?? new Date();
  const statusById = new Map(
    input.workItems.map((w) => [w.workItemId, w.status]),
  );
  const sessionsByItem = new Map<string, string[]>();
  const plannedIds = new Set(input.items.map((i) => i.workItemId));
  const unplanned: string[] = [];
  let sessionsCompleted = 0;
  let sessionsFailed = 0;
  let sessionsBlocked = 0;

  for (const session of input.sessions) {
    if (SESSION_COMPLETED.has(session.status)) sessionsCompleted += 1;
    else if (SESSION_FAILED.has(session.status)) sessionsFailed += 1;
    else if (SESSION_BLOCKED.has(session.status)) sessionsBlocked += 1;

    if (session.workItemId && plannedIds.has(session.workItemId)) {
      const list = sessionsByItem.get(session.workItemId) ?? [];
      list.push(session.sessionId);
      sessionsByItem.set(session.workItemId, list);
    } else {
      unplanned.push(session.sessionId);
    }
  }

  const counts: DailyPlanReview["counts"] = {
    done: 0,
    in_review: 0,
    running: 0,
    blocked: 0,
    failed: 0,
    not_started: 0,
    other: 0,
  };
  const items: DailyPlanReviewItem[] = [...input.items]
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const status = statusById.get(item.workItemId) ?? item.statusAtPlan;
      const outcome = outcomeForStatus(status);
      counts[outcome] += 1;
      return {
        workItemId: item.workItemId,
        title: item.title,
        identifier: item.identifier,
        outcome,
        status,
        sessionIds: sessionsByItem.get(item.workItemId) ?? [],
      };
    });

  return {
    items,
    counts,
    unplannedSessionIds: unplanned,
    sessionsCompleted,
    sessionsFailed,
    sessionsBlocked,
    generatedAt: now.toISOString(),
  };
}

function label(item: { identifier: string | null; title: string }): string {
  return item.identifier ? `${item.identifier} ${item.title}` : item.title;
}

/** The review as a person reads it: the verdict first, then the names. */
export function renderReviewSummary(
  planDate: string,
  review: DailyPlanReview,
): string {
  const total = review.items.length;
  const lines: string[] = [];
  if (total === 0) {
    lines.push(`No plan was set for ${planDate}.`);
  } else {
    const finished = review.counts.done + review.counts.in_review;
    lines.push(
      `${finished} of ${total} planned item${total === 1 ? "" : "s"} finished` +
        (review.counts.in_review > 0
          ? ` (${review.counts.in_review} waiting on your review)`
          : "") +
        `; ${review.counts.running} still running, ${review.counts.blocked} blocked, ${review.counts.failed} failed, ${review.counts.not_started} not started.`,
    );
  }
  const sessionLine = `${review.sessionsCompleted} session${review.sessionsCompleted === 1 ? "" : "s"} completed, ${review.sessionsFailed} failed, ${review.sessionsBlocked} blocked`;
  lines.push(
    review.unplannedSessionIds.length > 0
      ? `${sessionLine}; ${review.unplannedSessionIds.length} ran outside the plan.`
      : `${sessionLine}.`,
  );

  const section = (title: string, outcome: DailyPlanReviewItem["outcome"]) => {
    const rows = review.items.filter((i) => i.outcome === outcome);
    if (rows.length === 0) return;
    lines.push("");
    lines.push(`**${title}**`);
    for (const row of rows) lines.push(`- ${label(row)}`);
  };
  section("Needs your review", "in_review");
  section("Done", "done");
  section("Blocked", "blocked");
  section("Failed", "failed");
  section("Still running", "running");
  section("Not started", "not_started");
  return lines.join("\n");
}
