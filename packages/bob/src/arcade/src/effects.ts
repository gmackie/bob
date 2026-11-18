import { MILESTONE_LABEL, RELEASE_STAGE_PRESENTATION, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { ItemState, Milestone, ReleaseStage } from "@bob/sdlc-view";

import type { Beat } from "./beat";

/**
 * The motion grammar (BOB-91): what each beat looks, feels and (later) sounds like.
 * A parcel's move along the belt is already the effect for an ordinary advance, so most
 * beats add nothing; outcomes get a celebration, problems get a mark. Outcomes are
 * celebrated, activity never is.
 */
export type EffectKind = "burst" | "stamp" | "pulse" | "static";
export type Tone = "good" | "info" | "warn" | "bad";
/** Maps onto expo-haptics: notification success/warning/error, impact light. */
export type Haptic = "success" | "warning" | "error" | "light" | null;

export interface Effect {
  beatId: string;
  itemId: string | null;
  kind: EffectKind;
  text: string;
  tone: Tone;
  haptic: Haptic;
}

const MILESTONE_EFFECT: Record<Milestone, Omit<Effect, "beatId" | "itemId">> = {
  "execution-succeeded": { kind: "pulse", text: "BUILT", tone: "good", haptic: null },
  "review-ready": { kind: "stamp", text: "REVIEW READY", tone: "info", haptic: null },
  merged: { kind: "stamp", text: "MERGED", tone: "good", haptic: "light" },
  "production-verified": { kind: "burst", text: "SHIPPED", tone: "good", haptic: "success" },
};

const STAGE_EFFECT: Partial<Record<ReleaseStage, Omit<Effect, "beatId" | "itemId">>> = {
  "checks-running": { kind: "pulse", text: "CI", tone: "info", haptic: null },
  deploying: { kind: "pulse", text: "LAUNCH", tone: "info", haptic: null },
  blocked: { kind: "stamp", text: "BLOCKED", tone: "warn", haptic: "warning" },
};

export function effectFor(beat: Beat): Effect | null {
  const base = { beatId: beat.id, itemId: beat.subject.itemId ?? null };
  const data = beat.data ?? {};
  switch (beat.kind) {
    case "gap":
      return { ...base, kind: "static", text: "RESYNCING", tone: "warn", haptic: null };
    case "item.entered":
      return { ...base, kind: "pulse", text: "NEW", tone: "info", haptic: null };
    case "item.needs_human":
      return { ...base, kind: "pulse", text: "NEEDS YOU", tone: "warn", haptic: "warning" };
    case "item.failed":
      return { ...base, kind: "stamp", text: data.stage === "checks-failed" ? "CI MISS" : "FAILED", tone: "bad", haptic: "error" };
    case "item.looped":
      return { ...base, kind: "pulse", text: "LOOP", tone: "warn", haptic: null };
    case "milestone": {
      const m = data.milestone as Milestone | undefined;
      return m && m in MILESTONE_EFFECT ? { ...base, ...MILESTONE_EFFECT[m] } : null;
    }
    case "release.stage": {
      const to = data.to as ReleaseStage | undefined;
      const e = to ? STAGE_EFFECT[to] : undefined;
      return e ? { ...base, ...e } : null;
    }
    case "item.advanced":
    case "item.left":
      return null;
  }
}

/** One line for a beat ticker: "BOB-91 · Running → Validating". */
export function beatLine(beat: Beat): string {
  const who = beat.subject.issue ?? beat.subject.itemId ?? "edge";
  const d = beat.data ?? {};
  const state = (s: unknown) => (typeof s === "string" && s in STATE_PRESENTATION ? STATE_PRESENTATION[s as ItemState].label : String(s));
  const stage = (s: unknown) => (typeof s === "string" && s in RELEASE_STAGE_PRESENTATION ? RELEASE_STAGE_PRESENTATION[s as ReleaseStage].label : String(s));
  switch (beat.kind) {
    case "gap":
      return "Signal gap: resyncing with the SDLC edge";
    case "item.entered":
      return `${who} · joined the floor (${state(d.state)})`;
    case "item.left":
      return `${who} · left the floor`;
    case "item.advanced":
    case "item.looped":
    case "item.needs_human":
      return `${who} · ${state(d.from)} → ${state(d.to)}${beat.kind === "item.looped" ? " (loop)" : beat.kind === "item.needs_human" ? " · needs you" : ""}`;
    case "item.failed":
      return `${who} · ${d.stage ? stage(d.stage) : `${state(d.from)} → ${state(d.to)}`}`;
    case "release.stage":
      return `${who} · release ${d.from ? `${stage(d.from)} → ` : ""}${stage(d.to)}`;
    case "milestone":
      return `${who} · ${MILESTONE_LABEL[d.milestone as Milestone] ?? String(d.milestone)}`;
  }
}
