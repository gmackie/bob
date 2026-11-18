import { inScope, rows } from "@bob/sdlc-view";
import type { EdgeView, Scope } from "@bob/sdlc-view";

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
  deploying: number;
  /** Items completed in plans still on the floor. */
  shipped: number;
  failed: number;
}

const IN_FLIGHT = new Set(["reserved", "execution-unknown", "running", "waiting-input", "validating", "review", "deploying"]);

export function hud(view: EdgeView, scope: Scope = {}): Hud {
  const out: Hud = { agents: 0, inFlight: 0, ci: 0, needsYou: 0, deploying: 0, shipped: 0, failed: 0 };
  for (const row of rows(view)) {
    if (!inScope(row, scope)) continue;
    const s = row.item.state;
    if (s === "running") out.agents++;
    if (IN_FLIGHT.has(s)) out.inFlight++;
    if (s === "validating") out.ci++;
    if (s === "deploying") out.deploying++;
    if (s === "completed") out.shipped++;
    if (s === "failed") out.failed++;
    if (row.attention === "needs_human") out.needsYou++;
  }
  return out;
}
