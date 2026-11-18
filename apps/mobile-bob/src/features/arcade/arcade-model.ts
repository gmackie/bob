// The Arcade screen's state, without React (BOB-91 / BOB-92), so node tests cover it.
// Beats come from successive SDLC edge views; effects are the visible (and felt) part of
// the beats, kept for a short while and then dropped.
import { effectFor, sdlcBeats } from "@bob/arcade";
import type { Beat, BeatLog, Effect, Haptic } from "@bob/arcade";
import type { EdgeView } from "@bob/sdlc-view";

export interface LiveEffect extends Effect {
  born: number;
}

export const EFFECT_TTL_MS = 1_800;
/** More than this many effects at once reads as noise; keep the newest. */
export const MAX_EFFECTS = 12;

const HAPTIC_RANK: Record<Exclude<Haptic, null>, number> = { error: 0, success: 1, warning: 2, light: 3 };

export interface StepResult {
  beats: Beat[];
  effects: LiveEffect[];
  /** At most one haptic per step: the most important one, or null. */
  haptic: Haptic;
}

/**
 * Folds one new edge view into the screen: new beats into the log (deduped), their
 * effects into the live set, expired effects out.
 */
export function step(log: BeatLog, prev: EdgeView, next: EdgeView, effects: readonly LiveEffect[], now: number): StepResult {
  const beats = log.push(sdlcBeats(prev, next, now));
  const fresh = beats.flatMap((b) => {
    const e = effectFor(b);
    return e ? [{ ...e, born: now }] : [];
  });
  const live = [...effects.filter((e) => now - e.born < EFFECT_TTL_MS), ...fresh].slice(-MAX_EFFECTS);
  const haptic =
    fresh
      .map((e) => e.haptic)
      .filter((h): h is Exclude<Haptic, null> => h !== null)
      .sort((a, b) => HAPTIC_RANK[a] - HAPTIC_RANK[b])[0] ?? null;
  return { beats, effects: live, haptic };
}

export const expire = (effects: readonly LiveEffect[], now: number) => effects.filter((e) => now - e.born < EFFECT_TTL_MS);

export const TONE_COLOR = {
  good: "#7dffb0",
  info: "#6fb4ff",
  warn: "#ffd27a",
  bad: "#ff6b6b",
} as const;

/** A repository hue as a parcel fill: saturated enough to read on the dark stage. */
export const parcelFill = (hue: number) => `hsl(${hue}, 58%, 56%)`;
