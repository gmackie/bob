/**
 * BizPulse → Bob daily intake.
 *
 * BizPulse generates a daily briefing each morning with tasks assigned to
 * "founder" or "agent" (`tasks.todayBriefing`). Until now the agent tasks
 * reached Bob only when something filed them as Kanbanger issues by hand.
 * This pulls the briefing over BizPulse's tRPC API with an API key and turns
 * the agent-assigned tasks into Bob work items, once each.
 *
 * Two things make the dedupe non-trivial:
 * - BizPulse regenerates the briefing and its task ids are not stable, so the
 *   external id is derived from (date, startup, rule, title), which is.
 * - The same rule fires on consecutive days ("Retry failed payments"), so an
 *   open item with the same title in the same project is reused rather than
 *   duplicated, and the new day's occurrence is recorded on it.
 *
 * The fetch and the mapping are separated so the mapping is testable.
 */

export interface BizPulseDailyTask {
  id: string;
  startupId: string | null;
  title: string;
  description: string | null;
  assignee: "founder" | "agent";
  priority: "low" | "medium" | "high" | "critical";
  category: string | null;
  sourceRule: string | null;
  status: string;
  linkedUrl: string | null;
  sortOrder: number;
}

export interface BizPulseTodayBriefing {
  briefing: { id: string; date: string; status: string } | null;
  tasks: BizPulseDailyTask[];
  startupNames: Record<string, string>;
}

export interface BizPulseIntakeTask {
  externalId: string;
  title: string;
  description: string | null;
  /** The BizPulse startup, used as the Bob project. */
  projectName: string;
  startupId: string | null;
  queueSortOrder: number;
  externalUrl: string | null;
  sourceMetadata: Record<string, unknown>;
}

export const BIZPULSE_PROVIDER = "bizpulse";

const QUEUE_ORDER_BY_PRIORITY: Record<BizPulseDailyTask["priority"], number> = {
  critical: 10,
  high: 20,
  medium: 30,
  low: 50,
};

function nonEmpty(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function projectNameFor(
  startupId: string | null,
  names: Record<string, string>,
): string {
  const name = startupId ? nonEmpty(names[startupId]) : "";
  return name || "BizPulse portfolio";
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function slug(value: string): string {
  return normalizeTitle(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Stable per-day id for a briefing task; BizPulse's own ids churn. */
export function bizpulseExternalId(
  date: string,
  task: Pick<BizPulseDailyTask, "startupId" | "sourceRule" | "title">,
): string {
  return `bizpulse:${date}:${task.startupId ?? "portfolio"}:${task.sourceRule ?? "task"}:${slug(task.title)}`;
}

export function mapBriefingToIntakeTasks(
  briefing: BizPulseTodayBriefing,
  date: string,
): BizPulseIntakeTask[] {
  const meta = briefing.briefing;
  if (!meta) return [];
  return briefing.tasks
    .filter((task) => task.assignee === "agent")
    .filter(
      (task) => task.status === "pending" || task.status === "in_progress",
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => ({
      externalId: bizpulseExternalId(date, task),
      title:
        nonEmpty(task.title.replace(/\s+/g, " ")).slice(0, 256) ||
        "Untitled BizPulse task",
      description: nonEmpty(task.description) || null,
      projectName: projectNameFor(task.startupId, briefing.startupNames),
      startupId: task.startupId,
      queueSortOrder: QUEUE_ORDER_BY_PRIORITY[task.priority],
      externalUrl: task.linkedUrl,
      sourceMetadata: {
        source: BIZPULSE_PROVIDER,
        briefingId: meta.id,
        briefingDate: date,
        bizpulseTaskId: task.id,
        startupId: task.startupId,
        category: task.category,
        sourceRule: task.sourceRule,
        priority: task.priority,
      },
    }));
}

export interface BizPulseClientOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

/**
 * Reads today's briefing. BizPulse serves tRPC with superjson; a GET query
 * with no input is `GET /api/trpc/tasks.todayBriefing`, and the result is
 * wrapped as `{result: {data: {json: ...}}}`.
 */
export async function fetchBizPulseTodayBriefing(
  options: BizPulseClientOptions,
): Promise<BizPulseTodayBriefing> {
  const doFetch = options.fetch ?? fetch;
  const base = options.apiUrl.replace(/\/+$/, "");
  const response = await doFetch(`${base}/api/trpc/tasks.todayBriefing`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`BizPulse todayBriefing failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    result?: { data?: unknown };
    error?: { json?: { message?: string } };
  };
  if (body.error) {
    throw new Error(
      `BizPulse todayBriefing error: ${body.error.json?.message ?? "unknown"}`,
    );
  }
  const data = body.result?.data;
  const payload =
    data && typeof data === "object" && "json" in data ? data.json : data;
  if (payload === null || payload === undefined) {
    return { briefing: null, tasks: [], startupNames: {} };
  }
  const raw = payload as Partial<BizPulseTodayBriefing>;
  return {
    briefing: raw.briefing ?? null,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    startupNames: raw.startupNames ?? {},
  };
}
