// The web Floor's imports in one place (BOB-92): the shared Arcade core plus the short-lived
// effect type the panel keeps in state.
export { BOARD_LANES, beatLine, boardRowSummary, chooseDesks, createBeatLog, desks, effectFor, floorScene, floorSummary, hud, PARCEL_TONE, projectBoard, sameDesks, sdlcBeats, shippedToday } from "@bob/arcade";
export type { Board, BoardLane, BoardRow, Desk, Effect, FloorParcel } from "@bob/arcade";
export type { EdgeView, TrackedIssue } from "@bob/sdlc-view";

import type { Effect } from "@bob/arcade";

export interface LiveEffect extends Effect {
  born: number;
}

export const EFFECT_TTL_MS = 1_800;

export const expire = (effects: readonly LiveEffect[], now: number): LiveEffect[] => effects.filter((e) => now - e.born < EFFECT_TTL_MS);
