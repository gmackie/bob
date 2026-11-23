/**
 * The morning plan, as a decision rather than a query.
 *
 * Bob's queue is a flat list ordered by `queueSortOrder`, and the autonomous
 * loop eats it from the top up to a daily cap. That is a mechanism, not a
 * plan: nothing says what today is for, nothing is carried over on purpose,
 * and a person reviewing the day has no statement of intent to review
 * against. This builds that statement: pick what fits the cap, in an order
 * that honours yesterday's unfinished work and today's intake, and say why
 * each item is on the list in words a person would use.
 *
 * Pure so the choice is testable. The handler supplies the candidates.
 */

import type { DailyPlanItem } from "@bob/db/schema";

export interface PlanCandidate {
  workItemId: string;
  title: string;
  identifier: string | null;
  projectId: string | null;
  projectName: string | null;
  status: string;
  queueSortOrder: number;
  createdAt: string | Date | null;
  /** Set when the morning intake created or touched this item today. */
  intakeProvider?: string | null;
  /** Set when yesterday's plan had this item and it did not finish. */
  carriedOver?: boolean;
}

export interface BuildDailyPlanInput {
  planDate: string;
  candidates: readonly PlanCandidate[];
  /** How many items the loop will work today. */
  capacity: number;
  /** Items already running when the plan is built; they count against the cap. */
  inFlight: readonly PlanCandidate[];
}

export interface BuiltDailyPlan {
  items: DailyPlanItem[];
  summary: string;
  /** Candidates that did not fit, so the summary can say what waits. */
  deferred: PlanCandidate[];
}

const PLANNABLE = new Set([
  "todo",
  "ready",
  "backlog",
  "blocked",
  "in_progress",
]);

function toMillis(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function rank(candidate: PlanCandidate): number {
  // Work already in flight is the day's first commitment; then what we said
  // we would do yesterday; then the morning's intake, which is time-bound;
  // then the queue in its own order. Blocked items are planned only when
  // nothing else fits, because they wait on a person, not on capacity.
  if (candidate.status === "in_progress") return 0;
  if (candidate.carriedOver) return 1;
  if (candidate.intakeProvider) return 2;
  if (candidate.status === "blocked") return 4;
  return 3;
}

function objectiveFor(candidate: PlanCandidate): string {
  if (candidate.status === "in_progress")
    return "Already running; finish and get it to review.";
  if (candidate.carriedOver)
    return "Carried over from yesterday's plan; did not finish.";
  if (candidate.intakeProvider === "bizpulse")
    return "From this morning's BizPulse briefing.";
  if (candidate.intakeProvider)
    return `From this morning's ${candidate.intakeProvider} intake.`;
  if (candidate.status === "blocked")
    return "Blocked, waiting on a decision; unblock it to make room.";
  if (candidate.status === "ready") return "Next in the queue, marked ready.";
  return "Next in the queue.";
}

function sourceFor(candidate: PlanCandidate): DailyPlanItem["source"] {
  if (candidate.carriedOver) return "carryover";
  if (candidate.intakeProvider === "bizpulse") return "bizpulse";
  return "queue";
}

function groupByProject(
  items: readonly DailyPlanItem[],
): Map<string, DailyPlanItem[]> {
  const groups = new Map<string, DailyPlanItem[]>();
  for (const item of items) {
    const key = item.projectName ?? "No project";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function label(item: { identifier: string | null; title: string }): string {
  return item.identifier ? `${item.identifier} ${item.title}` : item.title;
}

export function renderPlanSummary(input: {
  planDate: string;
  items: readonly DailyPlanItem[];
  deferred: readonly PlanCandidate[];
  capacity: number;
  inFlightCount: number;
}): string {
  const lines: string[] = [];
  const { items, deferred, capacity } = input;
  if (items.length === 0) {
    lines.push(`Nothing planned for ${input.planDate}: the queue is empty.`);
    if (deferred.length > 0)
      lines.push(
        `${deferred.length} item(s) are waiting but could not be planned.`,
      );
    return lines.join("\n");
  }

  const carried = items.filter((i) => i.source === "carryover").length;
  const intake = items.filter((i) => i.source === "bizpulse").length;
  const running = input.inFlightCount;
  const opening = [
    `${items.length} item${items.length === 1 ? "" : "s"} planned against a cap of ${capacity}`,
    running > 0 ? `${running} already running` : null,
    carried > 0 ? `${carried} carried over` : null,
    intake > 0 ? `${intake} from BizPulse` : null,
  ]
    .filter(Boolean)
    .join(", ");
  lines.push(`${opening}.`);
  lines.push("");

  for (const [project, group] of groupByProject(items)) {
    lines.push(`**${project}**`);
    for (const item of group)
      lines.push(`- ${label(item)} — ${item.objective}`);
    lines.push("");
  }

  if (deferred.length > 0) {
    lines.push(
      `Not today (${deferred.length}): ${deferred
        .slice(0, 5)
        .map(label)
        .join("; ")}${deferred.length > 5 ? "; …" : ""}.`,
    );
  }
  return lines.join("\n").trimEnd();
}

export function buildDailyPlan(input: BuildDailyPlanInput): BuiltDailyPlan {
  const seen = new Set<string>();
  const pool: PlanCandidate[] = [];
  for (const candidate of [...input.inFlight, ...input.candidates]) {
    if (seen.has(candidate.workItemId)) continue;
    if (!PLANNABLE.has(candidate.status)) continue;
    seen.add(candidate.workItemId);
    pool.push(candidate);
  }

  pool.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const q = a.queueSortOrder - b.queueSortOrder;
    if (q !== 0) return q;
    return toMillis(a.createdAt) - toMillis(b.createdAt);
  });

  const capacity = Math.max(0, Math.floor(input.capacity));
  const chosen = pool.slice(0, capacity);
  const deferred = pool.slice(capacity);

  const items: DailyPlanItem[] = chosen.map((candidate, index) => ({
    workItemId: candidate.workItemId,
    title: candidate.title,
    identifier: candidate.identifier,
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    objective: objectiveFor(candidate),
    source: sourceFor(candidate),
    statusAtPlan: candidate.status,
    order: index,
  }));

  const inFlightCount = chosen.filter((c) => c.status === "in_progress").length;
  return {
    items,
    deferred,
    summary: renderPlanSummary({
      planDate: input.planDate,
      items,
      deferred,
      capacity,
      inFlightCount,
    }),
  };
}
