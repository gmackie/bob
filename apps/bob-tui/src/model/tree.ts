// The drill-down tree (fleet → project → repo → plan → item), derived from the edge view
// without React. Ported from apps/bob/src/components/sdlc/sdlc-page-model.ts: the same
// rows, grouping, scope and attention rules from @bob/sdlc-view, plus a plan level,
// because the TUI drills into plans where the web page opens them in place.
import {
  attentionRows,
  countsByState,
  groupRows,
  inScope,
  ITEM_STATES,
  planLayers,
  projectFor,
  repoKey,
  rows as toRows,
  itemAttention,
  type EdgeView,
  type ExecutionTarget,
  type IssueRef,
  type ItemSnapshot,
  type ItemState,
  type Milestone,
  type PlanSnapshot,
  type Row,
  type Scope,
} from "@bob/sdlc-view";

/** Where the user has drilled to. Each field implies the ones before it. */
export interface TreePath {
  startupId?: string;
  repoKey?: string;
  planId?: string;
  itemId?: string;
}

export type Level = "fleet" | "project" | "repo" | "plan" | "item";

export const levelOf = (path: TreePath): Level =>
  path.itemId ? "item" : path.planId ? "plan" : path.repoKey ? "repo" : path.startupId ? "project" : "fleet";

export type NodeKind = "project" | "repo" | "plan" | "item";

/** One row in the left pane. */
export interface TreeNode {
  kind: NodeKind;
  key: string;
  label: string;
  /** Items under it (1 for an item). */
  count: number;
  /** Items under it that need attention. */
  attention: number;
  /** Plan or item state, for a badge. */
  state?: string;
}

/** A plan's definition entry joined with its snapshot, when the view has one. */
export interface PlanEntry {
  itemId: string;
  issue: IssueRef;
  target: ExecutionTarget;
  item: ItemSnapshot | null;
}

export const itemLabel = (issue: IssueRef) => issue.identifier ?? issue.issueId;
export const planLabel = (plan: PlanSnapshot) => `plan ${plan.planId.slice(0, 8)}`;

/** Every definition item of a plan, in dependency-layer order, joined with its snapshot. */
export function planEntries(view: EdgeView, plan: PlanSnapshot): PlanEntry[] {
  const defs = new Map(plan.definition.items.map((d) => [d.itemId, d]));
  return planLayers(plan).flat().map((itemId) => {
    const def = defs.get(itemId)!;
    return { itemId, issue: def.issue, target: def.target, item: view.items[itemId] ?? null };
  });
}

/**
 * Plans placed under a scope. A plan is placed by its definition (not by item snapshots),
 * so a draft plan whose items the edge has not sent yet still appears: it belongs to every
 * project and repo one of its definition items targets.
 */
export function plansInScope(view: EdgeView, scope: Scope): PlanSnapshot[] {
  return Object.values(view.plans)
    .filter((plan) => plan.definition.items.some((d) => {
      const project = projectFor(view.topology, d.target.repository);
      return (!scope.startupId || project.startupId === scope.startupId) && (!scope.repoKey || repoKey(d.target.repository) === scope.repoKey);
    }))
    .sort((a, b) => a.planId.localeCompare(b.planId));
}

/** Projects and repos from rows, plus plans with no item snapshots yet (from their definitions). */
function definitionRows(view: EdgeView): Array<Pick<Row, "startupId" | "startupName" | "target"> & { attention: Row["attention"] }> {
  const out: Array<Pick<Row, "startupId" | "startupName" | "target"> & { attention: Row["attention"] }> = [];
  for (const plan of Object.values(view.plans)) {
    for (const d of plan.definition.items) {
      const item = view.items[d.itemId];
      out.push({ target: d.target, ...projectFor(view.topology, d.target.repository), attention: item ? itemAttention(item) : "ok" });
    }
  }
  return out;
}

/** The left pane's rows for a path: the children of the level, or, at the item level, the item's siblings. */
export function childrenOf(view: EdgeView, path: TreePath): TreeNode[] {
  const level = levelOf(path);
  const scope: Scope = { ...(path.startupId ? { startupId: path.startupId } : {}), ...(path.repoKey ? { repoKey: path.repoKey } : {}) };
  if (level === "fleet" || level === "project") {
    const groupLevel = level === "fleet" ? "project" : "repo";
    // groupRows counts rows; definitionRows covers draft plans without item snapshots.
    const list = definitionRows(view).filter((r) => inScope(r as Row, scope)) as Row[];
    return groupRows(list, groupLevel).map((g) => ({ kind: groupLevel, key: g.key, label: g.label, count: g.count, attention: g.attention }));
  }
  if (level === "repo") {
    return plansInScope(view, scope).map((plan) => {
      const entries = planEntries(view, plan);
      return {
        kind: "plan", key: plan.planId, label: planLabel(plan), state: plan.state, count: entries.length,
        attention: entries.filter((e) => e.item && itemAttention(e.item) !== "ok").length,
      };
    });
  }
  const plan = view.plans[path.planId!];
  if (!plan) return [];
  return planEntries(view, plan).map((e) => ({
    kind: "item", key: e.itemId, label: itemLabel(e.issue), count: 1,
    attention: e.item && itemAttention(e.item) !== "ok" ? 1 : 0,
    ...(e.item ? { state: e.item.state } : {}),
  }));
}

/** The path one level down through `node`. */
export function drillPath(path: TreePath, node: TreeNode): TreePath {
  switch (node.kind) {
    case "project": return { startupId: node.key };
    case "repo": return { startupId: path.startupId, repoKey: node.key };
    case "plan": return { startupId: path.startupId, repoKey: path.repoKey, planId: node.key };
    case "item": return { startupId: path.startupId, repoKey: path.repoKey, planId: path.planId, itemId: node.key };
  }
}

/** The path one level up; fleet stays fleet. */
export function upPath(path: TreePath): TreePath {
  if (path.itemId) return { startupId: path.startupId, repoKey: path.repoKey, planId: path.planId };
  if (path.planId) return { startupId: path.startupId, repoKey: path.repoKey };
  if (path.repoKey) return { startupId: path.startupId };
  return {};
}

/** The key of the node at `path`'s own level, to place the cursor on it after going up. */
export function keyAtLevel(path: TreePath): string | undefined {
  return path.itemId ?? path.planId ?? path.repoKey ?? path.startupId;
}

/** Breadcrumb labels for the header of the tree pane. */
export function breadcrumb(view: EdgeView, path: TreePath): string[] {
  const all = toRows(view);
  const out = ["Fleet"];
  if (path.startupId) out.push(all.find((r) => r.startupId === path.startupId)?.startupName ?? (path.startupId === "unassigned" ? "Unassigned" : path.startupId));
  if (path.repoKey) out.push(path.repoKey.slice(path.repoKey.indexOf(":") + 1));
  if (path.planId) out.push(view.plans[path.planId] ? planLabel(view.plans[path.planId]!) : path.planId.slice(0, 8));
  if (path.itemId) {
    const def = view.plans[path.planId ?? ""]?.definition.items.find((d) => d.itemId === path.itemId);
    out.push(def ? itemLabel(def.issue) : path.itemId.slice(0, 8));
  }
  return out;
}

/** What the center pane shows for the cursor. */
export type Focus =
  | { kind: "group"; label: string; counts: Record<ItemState, number>; plans: number }
  | { kind: "plan"; plan: PlanSnapshot; cursorItemId: string | null }
  | { kind: "item"; plan: PlanSnapshot; entry: PlanEntry }
  | { kind: "none" };

/**
 * The center pane's subject. At group levels the cursor's group (summary); at the repo
 * level the cursor's plan (its tree); inside a plan the plan, with the cursor's item
 * marked; at the item level the item.
 */
export function focusOf(view: EdgeView, path: TreePath, cursorNode: TreeNode | undefined): Focus {
  const level = levelOf(path);
  if (level === "item" || level === "plan") {
    const plan = view.plans[path.planId!];
    if (!plan) return { kind: "none" };
    if (level === "plan") return { kind: "plan", plan, cursorItemId: cursorNode?.key ?? null };
    const entry = planEntries(view, plan).find((e) => e.itemId === path.itemId);
    return entry ? { kind: "item", plan, entry } : { kind: "none" };
  }
  if (!cursorNode) return { kind: "none" };
  if (cursorNode.kind === "plan") {
    const plan = view.plans[cursorNode.key];
    return plan ? { kind: "plan", plan, cursorItemId: null } : { kind: "none" };
  }
  const scope: Scope = drillPath(path, cursorNode);
  const scoped = toRows(view).filter((r) => inScope(r, scope));
  return { kind: "group", label: cursorNode.label, counts: countsByState(scoped), plans: plansInScope(view, scope).length };
}

/** The plan and item commands target: the cursor's or the path's. */
export interface Selection { plan: PlanSnapshot | null; item: ItemSnapshot | null; itemLabel: string | null }

export function selectionOf(view: EdgeView, path: TreePath, cursorNode: TreeNode | undefined): Selection {
  const level = levelOf(path);
  const planId = level === "repo" && cursorNode?.kind === "plan" ? cursorNode.key : path.planId;
  const plan = planId ? view.plans[planId] ?? null : null;
  const itemId = level === "item" ? path.itemId : level === "plan" && cursorNode?.kind === "item" ? cursorNode.key : undefined;
  const item = itemId ? view.items[itemId] ?? null : null;
  const def = itemId && plan ? plan.definition.items.find((d) => d.itemId === itemId) : undefined;
  return { plan, item, itemLabel: def ? itemLabel(def.issue) : null };
}

/** The inbox strip: items that need a human, are stalled, or failed, worst first. */
export const inbox = (view: EdgeView): Row[] => attentionRows(toRows(view));

/** The path that opens an inbox row. */
export const pathForRow = (row: Row): TreePath => ({
  startupId: row.startupId, repoKey: repoKey(row.target.repository), planId: row.plan.planId, itemId: row.item.itemId,
});

/** Header counts. */
export function headerCounts(view: EdgeView): { plans: number; items: number; attention: number; byState: Record<ItemState, number> } {
  const all = toRows(view);
  return { plans: Object.keys(view.plans).length, items: all.length, attention: inbox(view).length, byState: countsByState(all) };
}

export const KNOWN_STATES: ReadonlySet<string> = new Set(ITEM_STATES);

// ── Plan dependency tree ─────────────────────────────────────────────────────

export interface TreeLine {
  itemId: string;
  depth: number;
  label: string;
  state: ItemState | null;
  /** The milestone the edge from the parent requires, when it is not execution-succeeded. */
  requires: Milestone | null;
  /** This item was already drawn above under another parent; its subtree is not repeated. */
  repeat: boolean;
}

/**
 * A plan's DAG as an indented tree (R6: no graph drawing). Roots are items with no
 * in-plan upstream; each downstream item is drawn under every upstream, fully the first
 * time and as a back-reference after. Items unreachable from a root (a cycle the
 * coordinator should have rejected) are appended at depth 0 so every item appears.
 */
export function dependencyTree(view: EdgeView, plan: PlanSnapshot): TreeLine[] {
  const entries = planEntries(view, plan);
  const byId = new Map(entries.map((e) => [e.itemId, e]));
  const children = new Map<string, Array<{ id: string; requires: Milestone }>>();
  const hasParent = new Set<string>();
  for (const d of plan.definition.dependencies) {
    if (!byId.has(d.upstreamItemId) || !byId.has(d.downstreamItemId)) continue;
    (children.get(d.upstreamItemId) ?? children.set(d.upstreamItemId, []).get(d.upstreamItemId)!).push({ id: d.downstreamItemId, requires: d.requiredMilestone });
    hasParent.add(d.downstreamItemId);
  }
  const lines: TreeLine[] = [];
  const drawn = new Set<string>();
  const visit = (id: string, depth: number, requires: Milestone | null) => {
    const e = byId.get(id)!;
    const repeat = drawn.has(id);
    lines.push({ itemId: id, depth, label: itemLabel(e.issue), state: e.item?.state ?? null, requires: requires === "execution-succeeded" ? null : requires, repeat });
    if (repeat) return;
    drawn.add(id);
    for (const child of children.get(id) ?? []) visit(child.id, depth + 1, child.requires);
  };
  for (const e of entries) if (!hasParent.has(e.itemId)) visit(e.itemId, 0, null);
  for (const e of entries) if (!drawn.has(e.itemId)) visit(e.itemId, 0, null);
  return lines;
}
