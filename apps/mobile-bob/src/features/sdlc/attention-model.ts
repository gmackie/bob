// What the Attention tab shows, derived from the edge view without React, so node tests
// cover it. Phone design (BOB-75 Phase 4): the fleet, a project and a repo (L1–L3) are a
// grid of state tiles with the next level's groups under it; a plan and an item (L4–L5)
// are list-first. The Attention list puts items waiting for input first.
import {
  attentionRows,
  countsByState,
  groupRows,
  inScope,
  isOffline,
  itemCommands,
  ITEM_STATES,
  MILESTONE_LABEL,
  planCommands,
  repoKey,
  rows as toRows,
  STATE_PRESENTATION,
  stripTerminalControls,
} from "@bob/sdlc-view";
import type {Attention, CommandOption, EdgeView, Group, ItemState, PlanSnapshot, Row, Scope} from "@bob/sdlc-view";

import type { Banner, EdgeConnection } from "./commands-model";

export const itemTitle = (row: Row) => row.issue.identifier ?? row.issue.issueId;
export const shortPlan = (planId: string) => planId.slice(0, 8);

// ── Banner ───────────────────────────────────────────────────────────────────

/** Socket down, auth refused, or the edge has not heard from the coordinator recently. */
export function bannerFor(view: EdgeView, connection: EdgeConnection, now: number, error: string | null = null): Banner | null {
  if (connection === "auth-failed") return { kind: "auth-failed", message: error ?? "The SDLC edge refused this session." };
  if (connection !== "live") return { kind: connection };
  if (view.epoch === null) return null;
  return isOffline(view, now) ? { kind: "coordinator-offline", since: view.coordinatorSeenAt } : null;
}

export function bannerText(banner: Banner, now: number): string {
  switch (banner.kind) {
    case "connecting":
      return "Connecting to the SDLC edge…";
    case "reconnecting":
      return "Offline. Reconnecting to the SDLC edge…";
    case "auth-failed":
      return banner.message;
    case "coordinator-offline": {
      if (banner.since === null) return "The coordinator has not reported in. Showing the last known state.";
      const minutes = Math.max(1, Math.round((now - banner.since) / 60_000));
      return `The coordinator was last heard from ${minutes} min ago. Showing the last known state.`;
    }
  }
}

// ── Attention list ───────────────────────────────────────────────────────────

export interface AttentionEntry {
  itemId: string;
  title: string;
  state: ItemState;
  stateLabel: string;
  attention: Attention;
  /** "repo · plan 1a2b3c4d" */
  context: string;
  projectName: string;
  /** The first pending question, for waiting-input items. */
  question: string | null;
}

/** Waiting-for-input first, then the rest of needs_human, failed, stalled; ties by title. */
export const ATTENTION_RANK = (row: Row): number =>
  row.item.state === "waiting-input" ? 0 : row.attention === "needs_human" ? 1 : row.attention === "failed" ? 2 : 3;

export function attentionEntries(view: EdgeView, scope: Scope = {}): AttentionEntry[] {
  const list = attentionRows(toRows(view).filter((r) => inScope(r, scope)));
  return list
    .sort((a, b) => ATTENTION_RANK(a) - ATTENTION_RANK(b) || itemTitle(a).localeCompare(itemTitle(b)) || a.item.itemId.localeCompare(b.item.itemId))
    .map((row) => ({
      itemId: row.item.itemId,
      title: itemTitle(row),
      state: row.item.state,
      stateLabel: STATE_PRESENTATION[row.item.state].label,
      attention: row.attention,
      context: `${row.target.repository.repositoryId} · plan ${shortPlan(row.plan.planId)}`,
      projectName: row.startupName,
      question: firstQuestion(row),
    }));
}

/** The first pending question as shown on one line: agent text, so terminal controls are stripped. */
function firstQuestion(row: Row): string | null {
  const question = row.item.pendingInput?.questions[0]?.question;
  return question === undefined ? null : stripTerminalControls(question);
}

// ── State tiles ──────────────────────────────────────────────────────────────

export interface StateTile { state: ItemState; label: string; count: number; attention: Attention; selected: boolean }

/** One tile per state, in the presentation's reading order (row, then column). Empty states stay, dimmed by the view. */
export function stateTiles(list: Row[], selected: ItemState | null = null): StateTile[] {
  const counts = countsByState(list);
  return [...ITEM_STATES]
    .sort((a, b) => STATE_PRESENTATION[a].row - STATE_PRESENTATION[b].row || STATE_PRESENTATION[a].col - STATE_PRESENTATION[b].col)
    .map((state) => ({ state, label: STATE_PRESENTATION[state].label, count: counts[state], attention: STATE_PRESENTATION[state].attention, selected: state === selected }));
}

// ── Drill-down ───────────────────────────────────────────────────────────────

export interface BrowseParams { project?: string; repo?: string; plan?: string; state?: string }

const STATE_SET = new Set<string>(ITEM_STATES);
export const parseState = (value: string | undefined): ItemState | null =>
  value && STATE_SET.has(value) ? (value as ItemState) : null;

/** /attention/browse?project=&repo=&plan=&state= */
export function browseHref(params: BrowseParams): string {
  const query = Object.entries(params)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");
  return query ? `/attention/browse?${query}` : "/attention/browse";
}

export const itemHref = (itemId: string) => `/attention/${encodeURIComponent(itemId)}`;

export interface PlanGroup { planId: string; label: string; state: PlanSnapshot["state"]; count: number; attention: number }

export function planGroups(list: Row[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of list) {
    const g = groups.get(row.plan.planId) ?? { planId: row.plan.planId, label: `Plan ${shortPlan(row.plan.planId)}`, state: row.plan.state, count: 0, attention: 0 };
    g.count++;
    if (row.attention !== "ok") g.attention++;
    groups.set(row.plan.planId, g);
  }
  return [...groups.values()].sort((a, b) => b.attention - a.attention || b.count - a.count || a.planId.localeCompare(b.planId));
}

export interface ItemListEntry { itemId: string; title: string; state: ItemState; stateLabel: string; attention: Attention; repo: string }

const listEntry = (row: Row): ItemListEntry => ({
  itemId: row.item.itemId,
  title: itemTitle(row),
  state: row.item.state,
  stateLabel: STATE_PRESENTATION[row.item.state].label,
  attention: row.attention,
  repo: row.target.repository.repositoryId,
});

export type BrowseLevel = "fleet" | "project" | "repo" | "plan";

export interface Crumb { label: string; href: string | null }

export interface BrowseModel {
  level: BrowseLevel;
  title: string;
  crumbs: Crumb[];
  /** L1–L3: the tile grid over the scope. Null at the plan level (list-first). */
  tiles: StateTile[] | null;
  /** L1: projects; L2: repos. */
  groups: { level: "project" | "repo"; items: Group[] } | null;
  /** L3: plans in the repo. */
  plans: PlanGroup[] | null;
  /** Items listed: at the plan level always; above it only when a state tile is selected. */
  items: ItemListEntry[] | null;
  plan: PlanSnapshot | null;
  planActions: CommandOption[];
  state: ItemState | null;
  status: "waiting" | "empty" | "ready";
}

export function browseModel(view: EdgeView, params: BrowseParams): BrowseModel {
  const all = toRows(view);
  const scope: Scope = { ...(params.project ? { startupId: params.project } : {}), ...(params.repo ? { repoKey: params.repo } : {}) };
  const state = parseState(params.state);
  const scoped = all.filter((r) => inScope(r, scope));
  const plan = params.plan ? (view.plans[params.plan] ?? null) : null;
  const inPlan = plan ? scoped.filter((r) => r.plan.planId === plan.planId) : scoped;
  const level: BrowseLevel = plan ? "plan" : scope.repoKey ? "repo" : scope.startupId ? "project" : "fleet";
  const status = view.epoch === null ? "waiting" : all.length === 0 ? "empty" : "ready";

  const crumbs: Crumb[] = [{ label: "Fleet", href: browseHref({}) }];
  if (scope.startupId) {
    const name = all.find((r) => r.startupId === scope.startupId)?.startupName ?? scope.startupId;
    crumbs.push({ label: name, href: browseHref({ project: scope.startupId }) });
  }
  if (scope.repoKey) {
    const name = all.find((r) => repoKey(r.target.repository) === scope.repoKey)?.target.repository.repositoryId ?? scope.repoKey;
    crumbs.push({ label: name, href: browseHref({ project: scope.startupId, repo: scope.repoKey }) });
  }
  if (plan) crumbs.push({ label: `Plan ${shortPlan(plan.planId)}`, href: null });
  // The last crumb is where you are: no link.
  const here: Crumb = { ...(crumbs.pop() ?? { label: "Fleet" }), href: null };
  crumbs.push(here);

  const filtered = state ? inPlan.filter((r) => r.item.state === state) : inPlan;
  const byAttention = (a: Row, b: Row) => ATTENTION_RANK(a) - ATTENTION_RANK(b) || itemTitle(a).localeCompare(itemTitle(b));
  const ranked = (list: Row[]) => [...list].sort((a, b) => (a.attention === "ok" ? 1 : 0) - (b.attention === "ok" ? 1 : 0) || byAttention(a, b));

  return {
    level,
    title: here.label,
    crumbs,
    tiles: level === "plan" ? null : stateTiles(scoped, state),
    groups: level === "fleet" ? { level: "project", items: groupRows(scoped, "project") } : level === "project" ? { level: "repo", items: groupRows(scoped, "repo") } : null,
    plans: level === "repo" && !state ? planGroups(scoped) : null,
    items: level === "plan" || state ? ranked(filtered).map(listEntry) : null,
    plan,
    planActions: plan ? planCommands(plan) : [],
    state,
    status,
  };
}

/** The params a group card drills into. */
export function drillParams(current: BrowseParams, level: "project" | "repo", group: Group): BrowseParams {
  return level === "project" ? { project: group.key } : { project: current.project, repo: group.key };
}

// ── Item detail ──────────────────────────────────────────────────────────────

export interface ItemDetail {
  row: Row;
  title: string;
  stateLabel: string;
  hint: string;
  attention: Attention;
  milestones: { key: string; label: string; achieved: boolean }[];
  thread: { environmentId: string; projectId: string; threadId: string; attemptId: string } | null;
  actions: CommandOption[];
  planActions: CommandOption[];
  planHref: string;
}

export function itemDetail(view: EdgeView, itemId: string): ItemDetail | null {
  const row = toRows(view).find((r) => r.item.itemId === itemId);
  if (!row) return null;
  const p = STATE_PRESENTATION[row.item.state];
  const achieved = new Set(row.item.achievedMilestones);
  const execution = row.item.execution;
  return {
    row,
    title: itemTitle(row),
    stateLabel: p.label,
    hint: p.hint,
    attention: p.attention,
    milestones: (Object.keys(MILESTONE_LABEL) as (keyof typeof MILESTONE_LABEL)[]).map((key) => ({ key, label: MILESTONE_LABEL[key], achieved: achieved.has(key) })),
    thread: execution
      ? { environmentId: execution.thread.environmentId, projectId: execution.thread.projectId, threadId: execution.thread.threadId, attemptId: execution.attemptId }
      : null,
    actions: itemCommands(row.item),
    planActions: planCommands(row.plan),
    planHref: browseHref({ project: row.startupId, repo: repoKey(row.target.repository), plan: row.plan.planId }),
  };
}
