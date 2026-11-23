import { groupRows, repoKey, rows } from "@bob/sdlc-view";
import type { EdgeView, Scope } from "@bob/sdlc-view";

import { hueFor } from "./floor";

/**
 * Scope chips over the floor (BOB-91 slice 3): one per connected project, and one per repo
 * inside the chosen project, so a big floor can be narrowed to what you're watching. Each
 * repo chip carries the same hue its parcels and desks use.
 */
export interface FloorScopeChip {
  /** The Scope this chip selects. */
  scope: Scope;
  /** Stable React key. */
  key: string;
  label: string;
  level: "project" | "repo";
  count: number;
  /** Items in the group that need attention (needs_human, failed, stalled). */
  attention: number;
  /** Repo chips only: the repo's parcel hue. */
  hue: number | null;
}

export interface FloorScopes {
  projects: FloorScopeChip[];
  /** Repos in the scoped project (or all repos when only one project is connected). */
  repos: FloorScopeChip[];
}

const byCount = (a: FloorScopeChip, b: FloorScopeChip) => b.count - a.count || a.label.localeCompare(b.label);

/**
 * The chips for a view. With one project the project row is empty (nothing to choose).
 * A scope whose project or repo has left the view still yields chips for what remains.
 */
export function floorScopes(view: EdgeView, scope: Scope = {}): FloorScopes {
  const all = rows(view);
  const projectGroups = groupRows(all, "project");
  const projects = projectGroups.length < 2 ? [] : projectGroups.map((g) => ({ scope: { startupId: g.key }, key: `p:${g.key}`, label: g.label, level: "project" as const, count: g.count, attention: g.attention, hue: null })).sort(byCount);
  const inProject = scope.startupId ? all.filter((r) => r.startupId === scope.startupId) : all;
  const repoGroups = groupRows(inProject, "repo");
  const repos = repoGroups.length < 2 && !scope.repoKey ? [] : repoGroups.map((g) => ({ scope: { ...(scope.startupId ? { startupId: scope.startupId } : {}), repoKey: g.key }, key: `r:${g.key}`, label: g.label, level: "repo" as const, count: g.count, attention: g.attention, hue: hueFor(g.key) })).sort(byCount);
  return { projects, repos };
}

/** A scope minus anything that no longer matches an item in the view (so a stale chip can't empty the floor). */
export function liveScope(view: EdgeView, scope: Scope): Scope {
  const all = rows(view);
  const startupId = scope.startupId && all.some((r) => r.startupId === scope.startupId) ? scope.startupId : undefined;
  const repo = scope.repoKey && all.some((r) => repoKey(r.target.repository) === scope.repoKey && (!startupId || r.startupId === startupId)) ? scope.repoKey : undefined;
  return { ...(startupId ? { startupId } : {}), ...(repo ? { repoKey: repo } : {}) };
}
