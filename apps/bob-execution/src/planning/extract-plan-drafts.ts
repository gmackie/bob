/**
 * Pull a machine-readable task list out of a planning agent's transcript.
 *
 * Both runners share this. The gateway is what writes plan drafts; the runners
 * only forward the parsed list, because the readable plan is often buried in
 * provider JSON rather than plain text.
 */

export const PLANNING_DRAFT_EXAMPLE_TITLE = "Name the real task";

export const PLANNING_DRAFT_INSTRUCTION = [
  "Analyze the codebase and write a plan.",
  "When the tasks are ready, end your reply with one fenced block tagged bob-plan. Bob creates a task from each entry in that block.",
  "```bob-plan",
  '{"tasks":[{"title":"Name the real task","description":"What done looks like","kind":"task","priority":"medium","dependsOn":[]}]}',
  "```",
  "kind is task, issue, or epic. priority is no_priority, low, medium, high, or urgent.",
  "dependsOn lists titles of other tasks in the same block.",
  "Keep each task small enough for one coding session.",
  "Write the analysis in prose before the block. Do not copy the example title into the block.",
].join("\n");

const KINDS = ["issue", "epic", "task"] as const;
const PRIORITIES = ["no_priority", "urgent", "high", "medium", "low"] as const;
const MAX_TASKS = 30;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 8000;

export type PlanningDraftKind = (typeof KINDS)[number];
export type PlanningDraftPriority = (typeof PRIORITIES)[number];

export interface ExtractedPlanningTask {
  title: string;
  description: string | null;
  kind: PlanningDraftKind;
  priority: PlanningDraftPriority;
  dependsOn: string[];
}

const FENCE = /```[ \t]*bob-plan[ \t]*\r?\n?([\s\S]*?)```/gi;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function titleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeKind(value: unknown): PlanningDraftKind {
  if (typeof value !== "string") return "task";
  const key = value.trim().toLowerCase();
  return (KINDS as readonly string[]).includes(key) ? (key as PlanningDraftKind) : "task";
}

function normalizePriority(value: unknown): PlanningDraftPriority {
  if (typeof value !== "string") return "no_priority";
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "none" || key === "") return "no_priority";
  return (PRIORITIES as readonly string[]).includes(key)
    ? (key as PlanningDraftPriority)
    : "no_priority";
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION) : text;
}

function dependencyTitles(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const titles: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const title = entry.trim().replace(/\s+/g, " ");
    if (!title || title.length > MAX_TITLE) continue;
    titles.push(title);
  }
  return titles;
}

/** Accept either `{ tasks: [...] }` or a bare array. Returns null when nothing parses. */
export function normalizePlanningTaskList(value: unknown): ExtractedPlanningTask[] | null {
  const record = asRecord(value);
  const raw = Array.isArray(value) ? value : record?.tasks;
  if (!Array.isArray(raw)) return null;

  const byKey = new Map<string, ExtractedPlanningTask>();
  for (const item of raw) {
    const task = asRecord(item);
    if (!task || typeof task.title !== "string") continue;
    const title = task.title.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);
    const key = titleKey(title);
    if (!key || key === titleKey(PLANNING_DRAFT_EXAMPLE_TITLE)) continue;
    byKey.set(key, {
      title,
      description: normalizeDescription(task.description),
      kind: normalizeKind(task.kind),
      priority: normalizePriority(task.priority),
      dependsOn: dependencyTitles(task.dependsOn ?? task.dependencies),
    });
  }

  const tasks = [...byKey.values()].slice(0, MAX_TASKS);
  for (const task of tasks) {
    const own = titleKey(task.title);
    const seen = new Set<string>();
    task.dependsOn = task.dependsOn.filter((dependency) => {
      const key = titleKey(dependency);
      if (!key || key === own || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return tasks.length > 0 ? tasks : null;
}

function tasksIn(text: string): ExtractedPlanningTask[] | null {
  FENCE.lastIndex = 0;
  const matches = [...text.matchAll(FENCE)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const body = matches[index]?.[1]?.trim();
    if (!body) continue;
    try {
      const tasks = normalizePlanningTaskList(JSON.parse(body) as unknown);
      if (tasks) return tasks;
    } catch {
      // A broken fence is ignored so an earlier valid block can still win.
    }
  }
  return null;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      if (!record) return "";
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("");
}

function assistantText(record: Record<string, unknown>): string | null {
  if (record.type === "item.completed") {
    const item = asRecord(record.item);
    if (item?.type !== "agent_message" || typeof item.text !== "string") return null;
    return item.text;
  }

  if (record.type === "assistant" || record.role === "assistant") {
    const message = asRecord(record.message) ?? record;
    const text = contentText(message.content) || (typeof message.text === "string" ? message.text : "");
    return text || null;
  }

  if (record.type === "result" && typeof record.result === "string") return record.result;
  if ((record.type === "text" || record.type === "agent_message") && typeof record.text === "string") {
    return record.text;
  }
  if (record.type === "text" && typeof record.data === "string") return record.data;
  return null;
}

function assistantSegments(source: string): string[] {
  const segments: string[] = [];
  const push = (value: unknown) => {
    const record = asRecord(value);
    if (!record) return;
    const text = assistantText(record);
    if (text) segments.push(text);
  };

  const trimmed = source.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) parsed.forEach(push);
      else push(parsed);
    } catch {
      // Fall through to line-oriented provider streams.
    }
  }

  if (segments.length > 0) return segments;

  for (const line of source.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("{")) continue;
    try {
      push(JSON.parse(trimmedLine) as unknown);
    } catch {
      // Progress lines that are not JSON stay out of the plan text.
    }
  }
  return segments;
}

function unescapeJsonString(source: string): string {
  return source
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"');
}

export function extractPlanningDrafts(source: string): ExtractedPlanningTask[] {
  if (!source.includes("bob-plan")) return [];

  const segments = assistantSegments(source);
  if (segments.length > 0) {
    const joined = tasksIn(segments.join(""));
    if (joined) return joined;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const found = tasksIn(segments[index] ?? "");
      if (found) return found;
    }
  }

  return tasksIn(source) ?? tasksIn(unescapeJsonString(source)) ?? [];
}
