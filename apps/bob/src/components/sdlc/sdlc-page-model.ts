// What the /sdlc page shows, derived from the edge view without React, so node tests cover it.
import {
  attentionRows,
  countsByState,
  groupRows,
  inScope,
  isOffline,
  repoKey,
  rows as toRows,
  type EdgeView,
  type Group,
  type ItemState,
  type Row,
  type Scope,
} from "@bob/sdlc-view";

import type { EdgeConnection } from "./edge-client";

export interface BreadcrumbItem { label: string; href?: string }

/** The drill-down scope lives in the URL: /sdlc?project=<startupId>&repo=<repoKey>. */
export function scopeFromParams(params: { get(name: string): string | null } | null | undefined): Scope {
  const startupId = params?.get("project") || undefined;
  const repo = params?.get("repo") || undefined;
  return { ...(startupId ? { startupId } : {}), ...(repo ? { repoKey: repo } : {}) };
}

export function sdlcHref(scope: Scope): string {
  const params = new URLSearchParams();
  if (scope.startupId) params.set("project", scope.startupId);
  if (scope.repoKey) params.set("repo", scope.repoKey);
  const query = params.toString();
  return query ? `/sdlc?${query}` : "/sdlc";
}

/** A repo's label is its bare repositoryId, as on its group card. */
const repoLabel = (key: string, all: Row[]) =>
  all.find((row) => repoKey(row.target.repository) === key)?.target.repository.repositoryId ?? key.slice(key.indexOf(":") + 1);

const projectLabel = (startupId: string, all: Row[]) =>
  all.find((row) => row.startupId === startupId)?.startupName ?? startupId;

/** Fleet → Project → Repo; the last crumb is the current level and has no link. */
export function breadcrumbs(scope: Scope, all: Row[]): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ label: "Fleet", href: sdlcHref({}) }];
  if (scope.startupId) items.push({ label: projectLabel(scope.startupId, all), href: sdlcHref({ startupId: scope.startupId }) });
  if (scope.repoKey) items.push({ label: repoLabel(scope.repoKey, all), href: sdlcHref(scope) });
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
}

export function sdlcPageModel(view: EdgeView, scope: Scope, state: ItemState | null): SdlcPageModel {
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
    breadcrumbs: breadcrumbs(scope, all),
    status,
  };
}

/** The scope a group card drills into. */
export const drillInto = (scope: Scope, level: "project" | "repo", group: Group): Scope =>
  level === "project" ? { startupId: group.key } : { ...scope, repoKey: group.key };

export const itemTitle = (row: Row) => row.issue.identifier ?? row.issue.issueId;
