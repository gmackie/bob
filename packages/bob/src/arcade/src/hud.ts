import { inScope, rows } from "@bob/sdlc-view";
import type { EdgeView, Scope } from "@bob/sdlc-view";

import { projectBoard } from "./board";

/** The HUD strip over the floor. Every number is a count of live items; none is a score. */
export interface Hud {
  /** Items with an agent attempt running right now. */
  agents: number;
  /** Items between admission and production (reserved … deploying). */
  inFlight: number;
  /** Items in CI. */
  ci: number;
  /** Items that need a human (attention needs_human). */
  needsYou: number;
  /** Items that have sat too long in a state the system should leave on its own (BOB-101). */
  stalled: number;
  deploying: number;
  /** Items completed in plans still on the floor. */
  shipped: number;
  failed: number;
}

const IN_FLIGHT = new Set(["reserved", "execution-unknown", "running", "waiting-input", "validating", "review", "deploying"]);

/** `now` turns on stall detection; without it `stalled` counts only execution-unknown items. */
export function hud(view: EdgeView, scope: Scope = {}, now?: number): Hud {
  const out: Hud = { agents: 0, inFlight: 0, ci: 0, needsYou: 0, stalled: 0, deploying: 0, shipped: 0, failed: 0 };
  for (const row of rows(view, now)) {
    if (!inScope(row, scope)) continue;
    const s = row.item.state;
    if (s === "running") out.agents++;
    if (IN_FLIGHT.has(s)) out.inFlight++;
    if (s === "validating") out.ci++;
    if (s === "deploying") out.deploying++;
    if (s === "completed") out.shipped++;
    if (s === "failed") out.failed++;
    if (row.attention === "needs_human") out.needsYou++;
    if (row.attention === "stalled") out.stalled++;
  }
  // The project board joins tracked issues to coordinator work and removes duplicates.
  // Repo and startup filters can only be applied to coordinator rows.
  if (now !== undefined && !scope.repoKey && !scope.startupId && Object.keys(view.issues ?? {}).length > 0) {
    const board = projectBoard(view, now);
    out.inFlight = board.started;
    out.ci = board.rows.reduce((sum, row) => sum + row.lanes.ci, 0);
    out.deploying = board.rows.reduce((sum, row) => sum + row.lanes.deploy, 0);
    out.failed = board.failed;
    out.stalled = board.stale;
  }
  return out;
}
