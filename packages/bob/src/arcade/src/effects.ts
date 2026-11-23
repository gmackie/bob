import { MILESTONE_LABEL, RELEASE_STAGE_PRESENTATION, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { ItemState, Milestone, ReleaseStage } from "@bob/sdlc-view";

import type { AgentAction } from "./attempt-beats";
import type { Beat } from "./beat";

/**
 * The motion grammar (BOB-91): what each beat looks, feels and (later) sounds like.
 * A parcel's move along the belt is already the effect for an ordinary advance, so most
 * beats add nothing; outcomes get a celebration, problems get a mark. Outcomes are
 * celebrated, activity never is: live tail lines only raise a spark (no text, no haptic).
 */
export type EffectKind = "burst" | "stamp" | "pulse" | "static" | "spark";
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

type Fx = Omit<Effect, "beatId" | "itemId">;

/** Checks the agent runs itself: [running, passed, failed] labels. */
const CHECK_TEXT: Partial<Record<AgentAction, [string, string, string]>> = {
  test: ["TESTING", "TESTS ✓", "TESTS ✗"],
  typecheck: ["TYPES…", "TYPES ✓", "TYPES ✗"],
  lint: ["LINT…", "LINT ✓", "LINT ✗"],
  build: ["BUILDING", "BUILD ✓", "BUILD ✗"],
};

function actionEffect(action: AgentAction, exit: number | null): Fx | null {
  const check = CHECK_TEXT[action];
  // The agent's own red tests are part of working, not a failure: warn, no haptic.
  if (check) return exit === null ? { kind: "spark", text: check[0], tone: "info", haptic: null } : exit === 0 ? { kind: "pulse", text: check[1], tone: "good", haptic: null } : { kind: "pulse", text: check[2], tone: "warn", haptic: null };
  switch (action) {
    case "install":
      return { kind: "spark", text: "DEPS", tone: "info", haptic: null };
    case "commit":
      return exit === null || exit === 0 ? { kind: "stamp", text: "COMMIT", tone: "good", haptic: null } : null;
    case "push":
      return exit === null || exit === 0 ? { kind: "stamp", text: "PUSHED", tone: "good", haptic: "light" } : { kind: "pulse", text: "PUSH ✗", tone: "warn", haptic: null };
    case "git":
      return null;
    default:
      return exit !== null && exit !== 0 ? { kind: "spark", text: "OOPS", tone: "warn", haptic: null } : null;
  }
}

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
    case "agent.activity":
      return { ...base, kind: "spark", text: "", tone: "info", haptic: null };
    case "agent.action": {
      const e = actionEffect(data.action as AgentAction, typeof data.exit === "number" ? data.exit : null);
      return e ? { ...base, ...e } : null;
    }
    case "ci.phase": {
      const phase = String(data.phase ?? "").toUpperCase();
      if (data.to === "running") return { ...base, kind: "spark", text: `▶ ${phase}`, tone: "info", haptic: null };
      if (data.to === "passed") return { ...base, kind: "pulse", text: `✓ ${phase}`, tone: "good", haptic: null };
      if (data.to === "failed") return { ...base, kind: "stamp", text: `✗ ${phase}`, tone: "bad", haptic: "error" };
      return null;
    }
    case "ci.green":
      return { ...base, kind: "burst", text: "GREEN", tone: "good", haptic: "success" };
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
    case "agent.activity":
      return `${who} · agent ${d.thread ?? "working"} (+${d.lines ?? 0} lines)`;
    case "agent.action":
      return `${who} · ${String(d.line ?? d.action)}`;
    case "ci.phase":
      return `${who} · CI ${String(d.phase)} ${d.from ? `${String(d.from)} → ` : ""}${String(d.to)}`;
    case "ci.green":
      return `${who} · CI green (${String(d.phases)} phases)`;
  }
}
