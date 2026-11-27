// The web Floor's imports in one place (BOB-92): the shared Arcade core plus the short-lived
// effect type the panel keeps in state.
export {
  BOARD_LANES,
  MOOD_LABEL,
  beatLine,
  beatTone,
  boardRowSummary,
  chooseDesks,
  ciBeats,
  ciProgress,
  createBeatLog,
  deskMood,
  desks,
  effectFor,
  floorScene,
  floorScopes,
  floorSummary,
  hud,
  liveCiPhases,
  liveScope,
  PARCEL_TONE,
  projectBoard,
  sameDesks,
  sdlcBeats,
  shippedToday,
  stationFor,
  tailBeats,
  tailLineTone,
} from "@bob/arcade";
export type { Beat, Board, BoardLane, BoardRow, Desk, DeskMood, Effect, FloorParcel, FloorScopeChip, StationId } from "@bob/arcade";
export type { CiMessage, EdgeView, Scope, TrackedIssue } from "@bob/sdlc-view";

import type { Beat, Effect } from "@bob/arcade";
import { inScope, rows } from "@bob/sdlc-view";
import type { EdgeView, Scope } from "@bob/sdlc-view";
import type { BurstKind } from "./spectacle";

import { stationFor } from "@bob/arcade";

export interface LiveEffect extends Effect {
  born: number;
}

export function floorCue(beat: Beat, visibleIds?: ReadonlySet<string>): BurstKind | null {
  if (visibleIds && beat.subject.itemId && !visibleIds.has(beat.subject.itemId)) return null;
  if (beat.kind === "ci.green") return "pr";
  if (beat.kind === "item.failed" || (beat.kind === "ci.phase" && beat.data?.to === "failed")) return "failure";
  if (beat.kind === "milestone" && beat.data?.milestone === "merged") return "merge";
  if (beat.kind === "milestone" && beat.data?.milestone === "production-verified") return "deploy";
  return null;
}

export const EFFECT_TTL_MS = 1_800;

export const expire = (effects: readonly LiveEffect[], now: number): LiveEffect[] => effects.filter((e) => now - e.born < EFFECT_TTL_MS);

/** Tracker identifiers by item id, so attempt beats (which only know the item) read "BOB-91". */
export const issueLabels = (view: EdgeView): Map<string, string> =>
  new Map(rows(view).map((r) => [r.item.itemId, r.issue.identifier ?? r.issue.issueId] as const));

/** The most items any one belt station holds in scope: how tall the floor wants to be. */
export function busiestStation(view: EdgeView, scope: Scope): number {
  const counts = new Map<string, number>();
  for (const r of rows(view)) if (inScope(r, scope)) counts.set(stationFor(r.item.state), (counts.get(stationFor(r.item.state)) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/** The floor's pixel height for a load: room for the busiest station's two-line parcels, between 260 and 400. */
export const floorHeight = (busiest: number) => Math.max(260, Math.min(400, 120 + busiest * 40));

/** Ticker lines worth reading: activity beats only move things, they never get a line. */
export const tickerBeats = (recent: readonly Beat[], n: number) => recent.filter((b) => b.kind !== "agent.activity").slice(0, n);
