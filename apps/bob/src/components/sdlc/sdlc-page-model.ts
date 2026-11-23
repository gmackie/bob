// What the /sdlc page shows, derived from the edge view without React, so node tests cover it.
import {
  attentionRows,
  countsByState,
  groupRows,
  inScope,
  isOffline,
  ITEM_STATES,
  repoKey,
  rows as toRows,
  type EdgeView,
  type Group,
  type ItemState,
  type PlanSnapshot,
  type Row,
  type Scope,
} from "@bob/sdlc-view";

import type { EdgeConnection } from "./edge-client";

export interface BreadcrumbItem { label: string; href?: string }

type Params = { get(name: string): string | null } | null | undefined;

/** The drill-down scope and state filter live in the URL: /sdlc?project=<startupId>&repo=<repoKey>&state=<ItemState>. */
export function scopeFromParams(params: Params): Scope {
  const startupId = params?.get("project") || undefined;
  const repo = params?.get("repo") || undefined;
  return { ...(startupId ? { startupId } : {}), ...(repo ? { repoKey: repo } : {}) };
}

const STATE_SET = new Set<string>(ITEM_STATES);
/** The selected state from ?state=, or null when absent or not a known state. */
export function stateFromParams(params: Params): ItemState | null {
  const state = params?.get("state");
  return state && STATE_SET.has(state) ? (state as ItemState) : null;
}

/** The item ?item= points at (an SDLC push or inbox row, BOB-81), or null when absent or empty. */
export function itemFromParams(params: Params): string | null {
  return params?.get("item") || null;
}

/**
 * The selection after ?item= changed: a new item from the URL replaces the selection (a
 * second notification tapped while the page is open); no item in the URL keeps what the
 * person picked on the page.
 */
export function selectionForItemParam(current: string | null, fromUrl: string | null): string | null {
  return fromUrl ?? current;
}

export function sdlcHref(scope: Scope, state: ItemState | null = null): string {
  const params = new URLSearchParams();
  if (scope.startupId) params.set("project", scope.startupId);
  if (scope.repoKey) params.set("repo", scope.repoKey);
  if (state) params.set("state", state);
  const query = params.toString();
  return query ? `/sdlc?${query}` : "/sdlc";
}

/** A repo's label is its bare repositoryId, as on its group card. */
const repoLabel = (key: string, all: Row[]) =>
  all.find((row) => repoKey(row.target.repository) === key)?.target.repository.repositoryId ?? key.slice(key.indexOf(":") + 1);

const projectLabel = (startupId: string, all: Row[]) =>
  all.find((row) => row.startupId === startupId)?.startupName ?? startupId;

/** Fleet → Project → Repo, keeping the state filter; the last crumb is the current level and has no link. */
export function breadcrumbs(scope: Scope, all: Row[], state: ItemState | null = null): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ label: "Fleet", href: sdlcHref({}, state) }];
  if (scope.startupId) items.push({ label: projectLabel(scope.startupId, all), href: sdlcHref({ startupId: scope.startupId }, state) });
  if (scope.repoKey) items.push({ label: repoLabel(scope.repoKey, all), href: sdlcHref(scope, state) });
  delete items[items.length - 1]!.href;
  return items;
}

export type Banner =
  | { kind: "connecting" | "reconnecting" }
  | { kind: "coordinator-offline"; since: number | null };

/** The socket is down, or the edge has not heard from the coordinator in OFFLINE_AFTER_MS. */
export function bannerFor(view: EdgeView, connection: EdgeConnection, now: number): Banner | null {
  if (connection !== "live") return { kind: connection };
  if (view.epoch === null) return null; // the hello's reply is on its way
  return isOffline(view, now) ? { kind: "coordinator-offline", since: view.coordinatorSeenAt } : null;
}

export interface SdlcPageModel {
  all: Row[];
  scoped: Row[];
  /** scoped, narrowed to the selected state. */
  listed: Row[];
  counts: Record<ItemState, number>;
  groupLevel: "project" | "repo" | null;
  groups: Group[];
  attention: Row[];
  breadcrumbs: BreadcrumbItem[];
  /** waiting: no snapshot yet; empty: a snapshot with no plans or items; ready otherwise. */
  status: "waiting" | "empty" | "ready";
  /** The selected item, only while it is in scope. */
  selected: Row | null;
  /** The opened plan, only while at least one of its items is in scope. */
  plan: PlanSnapshot | null;
}

export interface Selection { itemId: string | null; planId: string | null }

/**
 * Selection is looked up in the scoped rows, so drilling somewhere that does not hold
 * the selected item (or any item of the opened plan) hides its detail rather than
 * showing an item from outside the breadcrumb.
 */
export function sdlcPageModel(view: EdgeView, scope: Scope, state: ItemState | null, selection: Selection = { itemId: null, planId: null }): SdlcPageModel {
  const all = toRows(view);
  const scoped = all.filter((row) => inScope(row, scope));
  const groupLevel = scope.repoKey ? null : scope.startupId ? "repo" : "project";
  const status = view.epoch === null ? "waiting" : Object.keys(view.plans).length === 0 && Object.keys(view.items).length === 0 ? "empty" : "ready";
  return {
    all,
    scoped,
    listed: state ? scoped.filter((row) => row.item.state === state) : scoped,
    counts: countsByState(scoped),
    groupLevel,
    groups: groupLevel ? groupRows(scoped, groupLevel) : [],
    attention: attentionRows(scoped),
    breadcrumbs: breadcrumbs(scope, all, state),
    status,
    selected: selection.itemId ? scoped.find((row) => row.item.itemId === selection.itemId) ?? null : null,
    plan: selection.planId && scoped.some((row) => row.plan.planId === selection.planId) ? view.plans[selection.planId] ?? null : null,
  };
}

/** The scope a group card drills into. */
export const drillInto = (scope: Scope, level: "project" | "repo", group: Group): Scope =>
  level === "project" ? { startupId: group.key } : { ...scope, repoKey: group.key };

export const itemTitle = (row: Row) => row.issue.identifier ?? row.issue.issueId;
