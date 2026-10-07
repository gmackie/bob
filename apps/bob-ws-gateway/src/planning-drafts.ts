/**
 * Decide which plan drafts a planning_drafts event should write.
 * The database apply step stays next to this so a repeated delivery is a no-op.
 */

export const PLANNING_DRAFT_EXAMPLE_TITLE = "Name the real task";

const KINDS = ["issue", "epic", "task"] as const;
const PRIORITIES = ["no_priority", "urgent", "high", "medium", "low"] as const;
const MAX_TASKS = 30;
const MAX_TITLE = 256;
const MAX_DESCRIPTION = 8000;

export type PlanningDraftKind = (typeof KINDS)[number];
export type PlanningDraftPriority = (typeof PRIORITIES)[number];

export interface PlannedTask {
  key: string;
  title: string;
  description: string | null;
  kind: PlanningDraftKind;
  priority: PlanningDraftPriority;
  sortOrder: number;
  dependsOn: string[];
}

export interface ExistingPlanDraft {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  priority: string;
  sortOrder: number;
  status: string;
}

export interface PlanDraftSyncPlan {
  inserts: PlannedTask[];
  updates: Array<{
    id: string;
    description: string | null;
    kind: PlanningDraftKind;
    priority: PlanningDraftPriority;
    sortOrder: number;
  }>;
  dependencies: Array<{ fromKey: string; toKey: string }>;
}

export function planningDraftTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

export function normalizePlanningTasks(payload: unknown): PlannedTask[] {
  const record = asRecord(payload);
  const raw = Array.isArray(payload) ? payload : record?.tasks;
  if (!Array.isArray(raw)) return [];

  const byKey = new Map<string, PlannedTask>();
  raw.forEach((item, index) => {
    const task = asRecord(item);
    if (!task || typeof task.title !== "string") return;
    const title = task.title.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);
    const key = planningDraftTitleKey(title);
    if (!key || key === planningDraftTitleKey(PLANNING_DRAFT_EXAMPLE_TITLE)) return;
    const dependsOn = (Array.isArray(task.dependsOn) ? task.dependsOn : task.dependencies);
    const dependencyKeys = Array.isArray(dependsOn)
      ? dependsOn
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => planningDraftTitleKey(entry))
          .filter(Boolean)
      : [];
    byKey.set(key, {
      key,
      title,
      description: normalizeDescription(task.description),
      kind: normalizeKind(task.kind),
      priority: normalizePriority(task.priority),
      sortOrder: index,
      dependsOn: dependencyKeys,
    });
  });

  const tasks = [...byKey.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, MAX_TASKS)
    .map((task, index) => ({ ...task, sortOrder: index }));
  return tasks.map((task) => ({
    ...task,
    dependsOn: [...new Set(task.dependsOn.filter((key) => key !== task.key))],
  }));
}

export function planDraftSync(
  existing: ExistingPlanDraft[],
  tasks: PlannedTask[],
): PlanDraftSyncPlan {
  const draftsByKey = new Map<string, ExistingPlanDraft>();
  const blockedKeys = new Set<string>();
  const targetKeys = new Set<string>();

  for (const row of existing) {
    const key = planningDraftTitleKey(row.title);
    if (!key) continue;
    if (row.status === "draft") {
      if (!draftsByKey.has(key)) draftsByKey.set(key, row);
      targetKeys.add(key);
    } else if (row.status === "committed") {
      blockedKeys.add(key);
      targetKeys.add(key);
    } else if (row.status === "discarded") {
      blockedKeys.add(key);
    }
  }

  const inserts: PlannedTask[] = [];
  const updates: PlanDraftSyncPlan["updates"] = [];
  const sourceKeys = new Set<string>();

  for (const task of tasks) {
    const draft = draftsByKey.get(task.key);
    if (draft) {
      sourceKeys.add(task.key);
      targetKeys.add(task.key);
      if (
        (draft.description ?? null) !== task.description ||
        draft.kind !== task.kind ||
        draft.priority !== task.priority ||
        draft.sortOrder !== task.sortOrder
      ) {
        updates.push({
          id: draft.id,
          description: task.description,
          kind: task.kind,
          priority: task.priority,
          sortOrder: task.sortOrder,
        });
      }
      continue;
    }
    if (blockedKeys.has(task.key)) continue;
    inserts.push(task);
    sourceKeys.add(task.key);
    targetKeys.add(task.key);
  }

  const dependencies: PlanDraftSyncPlan["dependencies"] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!sourceKeys.has(task.key)) continue;
    for (const toKey of task.dependsOn) {
      if (!targetKeys.has(toKey)) continue;
      const pair = `${task.key}\0${toKey}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      dependencies.push({ fromKey: task.key, toKey });
    }
  }

  return { inserts, updates, dependencies };
}

export function missingDraftDependencies(
  existing: ExistingPlanDraft[],
  inserted: Array<{ key: string; id: string }>,
  desired: Array<{ fromKey: string; toKey: string }>,
  already: Array<{ draftId: string; dependsOnDraftId: string }>,
): Array<{ draftId: string; dependsOnDraftId: string }> {
  const idByKey = new Map<string, string>();
  for (const row of existing) {
    if (row.status !== "committed") continue;
    const key = planningDraftTitleKey(row.title);
    if (key) idByKey.set(key, row.id);
  }
  for (const row of existing) {
    if (row.status !== "draft") continue;
    const key = planningDraftTitleKey(row.title);
    if (key) idByKey.set(key, row.id);
  }
  for (const row of inserted) idByKey.set(row.key, row.id);

  const have = new Set(already.map((row) => `${row.draftId}\0${row.dependsOnDraftId}`));
  const missing: Array<{ draftId: string; dependsOnDraftId: string }> = [];
  for (const dependency of desired) {
    const draftId = idByKey.get(dependency.fromKey);
    const dependsOnDraftId = idByKey.get(dependency.toKey);
    if (!draftId || !dependsOnDraftId || draftId === dependsOnDraftId) continue;
    const pair = `${draftId}\0${dependsOnDraftId}`;
    if (have.has(pair)) continue;
    have.add(pair);
    missing.push({ draftId, dependsOnDraftId });
  }
  return missing;
}
