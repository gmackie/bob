import { ITEM_STATES, type ItemState, type Milestone, type PlanState } from "./generated/contract";
import { STATE_PRESENTATION, type Attention } from "./presentation";

export interface RepositoryRef { integrationId: string; repositoryId: string }
export interface ExecutionTarget { environmentId: string; projectId: string; repository: RepositoryRef }
export interface ThreadRef { environmentId: string; projectId: string; threadId: string; turnId?: string | null }
export interface IssueRef { integrationId: string; workspaceId: string; teamId: string; projectId: string; issueId: string; identifier?: string | null; url?: string | null }
/** The coordinator's GetPlan response (the fields the view reads). */
export interface PlanSnapshot {
  planId: string;
  resourceVersion: number;
  state: PlanState;
  definition: {
    items: Array<{ itemId: string; issue: IssueRef; target: ExecutionTarget; completionTarget: string }>;
    dependencies: Array<{ upstreamItemId: string; downstreamItemId: string; requiredMilestone: Milestone }>;
    concurrencyLimit: number;
  };
}
/** The coordinator's GetItem `item` (the fields the view reads). */
export interface ItemSnapshot {
  itemId: string;
  planId: string;
  resourceVersion: number;
  state: ItemState;
  currentAttemptId?: string | null;
  execution?: { attemptId: string; target: ExecutionTarget; thread: ThreadRef } | null;
  achievedMilestones: Milestone[];
  operationIds: string[];
  evidenceRefs: string[];
}
/** A BizPulse repos.list row reduced to what the join needs. */
export interface TopologyRepo { startupId: string; startupName: string; repoSlug: string }
export interface EdgeView {
  /** The edge's message sequence. Deltas from one edge are contiguous (seq, seq + 1, ...). */
  seq: number;
  plans: Record<string, PlanSnapshot>;
  items: Record<string, ItemSnapshot>;
  topology: TopologyRepo[];
  /**
   * When the edge last heard from the coordinator: the edge's own receive time
   * (Date.now() in the edge), not the coordinator's clock. isOffline() compares it
   * with the browser's clock; skew between the edge and the browser is accepted.
   */
  coordinatorSeenAt: number | null;
  /** A delta skipped a seq: the view is applied but incomplete until the next snapshot. */
  needsResync: boolean;
}
export type EdgeMessage =
  | { type: "snapshot"; seq: number; plans: PlanSnapshot[]; items: ItemSnapshot[]; topology: TopologyRepo[]; coordinatorSeenAt: number | null }
  | { type: "delta"; seq: number; plans: PlanSnapshot[]; items: ItemSnapshot[]; coordinatorSeenAt: number | null }
  | { type: "status"; coordinatorSeenAt: number | null };

export const emptyView = (): EdgeView => ({ seq: 0, plans: {}, items: {}, topology: [], coordinatorSeenAt: null, needsResync: false });
const newer = <T extends { resourceVersion: number }>(current: T | undefined, next: T) => !current || next.resourceVersion > current.resourceVersion;
const later = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
/** Plans in these states never live in the view. */
export const TERMINAL_PLAN_STATES: ReadonlySet<PlanState> = new Set<PlanState>(["completed", "cancelled"]);

/**
 * Folds an edge message into the view.
 * - snapshot: always applies and replaces everything, including seq, and clears needsResync.
 * - delta: dropped when seq <= view.seq (a late or repeated delta), except that
 *   coordinatorSeenAt still moves forward. Otherwise it keeps the newest
 *   resourceVersion per resource. A seq jump past view.seq + 1 still applies but
 *   sets needsResync until the next snapshot.
 * - status: only moves coordinatorSeenAt forward.
 * Terminal plans, one rule everywhere: a plan whose state is completed or cancelled
 * is removed along with all of its items, whether it arrives in a delta or a snapshot
 * (the exporter already leaves them out of snapshots). Completed items inside a
 * non-terminal plan stay.
 */
export function reduce(view: EdgeView, message: EdgeMessage): EdgeView {
  if (message.type === "status") return { ...view, coordinatorSeenAt: later(view.coordinatorSeenAt, message.coordinatorSeenAt) };
  const snapshot = message.type === "snapshot";
  if (!snapshot && message.seq <= view.seq) return { ...view, coordinatorSeenAt: later(view.coordinatorSeenAt, message.coordinatorSeenAt) };
  const base = snapshot ? { ...emptyView(), topology: message.topology } : view;
  const plans = { ...base.plans }, items = { ...base.items };
  const evicted = new Set<string>();
  for (const p of message.plans) {
    if (TERMINAL_PLAN_STATES.has(p.state)) { evicted.add(p.planId); delete plans[p.planId]; }
    else if (newer(plans[p.planId], p)) plans[p.planId] = p;
  }
  for (const i of message.items) if (!evicted.has(i.planId) && newer(items[i.itemId], i)) items[i.itemId] = i;
  if (evicted.size) for (const [id, i] of Object.entries(items)) if (evicted.has(i.planId)) delete items[id];
  return {
    ...base,
    seq: message.seq,
    plans,
    items,
    coordinatorSeenAt: snapshot ? message.coordinatorSeenAt : later(view.coordinatorSeenAt, message.coordinatorSeenAt),
    needsResync: snapshot ? false : view.needsResync || message.seq > view.seq + 1,
  };
}

export const UNASSIGNED = { startupId: "unassigned", startupName: "Unassigned" } as const;
/**
 * BizPulse owns the mapping: a ForgeGraph repository joins by its full slug, or
 * else by the slug's last segment when exactly one topology repo has that segment.
 * An ambiguous last segment goes under Unassigned rather than guessing.
 */
export function projectFor(topology: TopologyRepo[], ref: RepositoryRef): { startupId: string; startupName: string } {
  if (ref.integrationId !== "forgegraph") return UNASSIGNED;
  const id = ref.repositoryId.toLowerCase();
  const slug = (repo: TopologyRepo) => repo.repoSlug.toLowerCase();
  const exact = topology.find((repo) => slug(repo) === id);
  const bySegment = exact ? [] : topology.filter((repo) => slug(repo).split("/").at(-1) === id);
  const hit = exact ?? (bySegment.length === 1 ? bySegment[0] : undefined);
  return hit ? { startupId: hit.startupId, startupName: hit.startupName } : UNASSIGNED;
}

/** Identifies a repository across integrations (a GitHub "bob" is not a ForgeGraph "bob"). */
export const repoKey = (ref: RepositoryRef) => `${ref.integrationId}:${ref.repositoryId}`;

export interface Row { item: ItemSnapshot; plan: PlanSnapshot; target: ExecutionTarget; issue: IssueRef; startupId: string; startupName: string; attention: Attention }
/** One row per item whose plan (and its definition of the item) the view has. */
export function rows(view: EdgeView): Row[] {
  const out: Row[] = [];
  for (const item of Object.values(view.items)) {
    const plan = view.plans[item.planId];
    const def = plan?.definition.items.find((d) => d.itemId === item.itemId);
    if (!plan || !def) continue;
    out.push({ item, plan, target: def.target, issue: def.issue, ...projectFor(view.topology, def.target.repository), attention: STATE_PRESENTATION[item.state].attention });
  }
  return out;
}

export interface Scope { startupId?: string; repoKey?: string }
export const inScope = (row: Row, scope: Scope) =>
  (!scope.startupId || row.startupId === scope.startupId) && (!scope.repoKey || repoKey(row.target.repository) === scope.repoKey);

export function countsByState(list: Row[]): Record<ItemState, number> {
  const counts = Object.fromEntries(ITEM_STATES.map((s) => [s, 0])) as Record<ItemState, number>;
  for (const row of list) counts[row.item.state]++;
  return counts;
}

export interface Group { key: string; label: string; count: number; attention: number }
/**
 * Groups for the drill-down; Unassigned sorts last, then by size, then by label.
 * Repo groups are keyed by repoKey() (use it as Scope.repoKey) and labelled with the bare repositoryId.
 */
export function groupRows(list: Row[], level: "project" | "repo"): Group[] {
  const groups = new Map<string, Group>();
  for (const row of list) {
    const key = level === "project" ? row.startupId : repoKey(row.target.repository);
    const label = level === "project" ? row.startupName : row.target.repository.repositoryId;
    const group = groups.get(key) ?? { key, label, count: 0, attention: 0 };
    group.count++;
    if (row.attention !== "ok") group.attention++;
    groups.set(key, group);
  }
  const last = (g: Group) => (level === "project" && g.key === UNASSIGNED.startupId ? 1 : 0);
  return [...groups.values()].sort((a, b) => last(a) - last(b) || b.count - a.count || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

const ATTENTION_ORDER: Record<Attention, number> = { needs_human: 0, failed: 1, stalled: 2, ok: 3 };
export const attentionRows = (list: Row[]) =>
  list.filter((r) => r.attention !== "ok").sort((a, b) => ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention]);

/**
 * Layers a plan's items by longest dependency path. The coordinator rejects cycles;
 * if one arrives anyway the passes are bounded, every known item still appears
 * exactly once, and empty layers are dropped. Dependencies on unknown items are ignored.
 */
export function planLayers(plan: PlanSnapshot): string[][] {
  const ids = plan.definition.items.map((i) => i.itemId);
  const depth = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0, changed = true; changed && pass < ids.length; pass++) {
    changed = false;
    for (const d of plan.definition.dependencies) {
      if (!depth.has(d.upstreamItemId) || !depth.has(d.downstreamItemId)) continue;
      const next = (depth.get(d.upstreamItemId) ?? 0) + 1;
      if (next > (depth.get(d.downstreamItemId) ?? 0)) { depth.set(d.downstreamItemId, next); changed = true; }
    }
  }
  const layers: string[][] = [];
  for (const id of ids) (layers[depth.get(id) ?? 0] ??= []).push(id);
  return layers.filter((layer) => layer !== undefined);
}

export const OFFLINE_AFTER_MS = 90_000;
export const isOffline = (view: EdgeView, now: number) => view.coordinatorSeenAt === null || now - view.coordinatorSeenAt > OFFLINE_AFTER_MS;
