import type { CiMessage, CiPhase } from "@bob/sdlc-view";

import { classifyLine } from "./attempt-beats";
import type { Beat } from "./beat";
import type { Desk } from "./desks";
import { effectFor } from "./effects";
import type { Tone } from "./effects";

/**
 * Visual mood for an agent desk or active parcel, derived purely from real WebSocket data
 * (live tail lines, CI phases, state, and attention). Shared by web and mobile so both
 * surfaces animate the same character expressions and terminal accents.
 */
export type DeskMood =
  | "asking"
  | "testing"
  | "building"
  | "shipping"
  | "coding"
  | "ci-running"
  | "ci-green"
  | "ci-failed"
  | "stalled"
  | "idle";

export type TailLineTone = "command-run" | "command-ok" | "command-fail" | "question" | "prose";

const ASKING_RE = /^(asking:|question:|\?\s)/i;
const TEST_PROSE_RE = /\b(vitest|jest|pytest|tests?|passed|failed)\b/i;
const BUILD_PROSE_RE = /\b(typecheck|lint|build|compil|bundl)\b/i;

/** Classifies a single tail line for CRT terminal syntax tinting. */
export function tailLineTone(line: string): TailLineTone {
  const trimmed = line.trim();
  if (ASKING_RE.test(trimmed)) return "question";
  const cmd = classifyLine(trimmed);
  if (cmd) {
    if (cmd.exit === null) return "command-run";
    return cmd.exit === 0 ? "command-ok" : "command-fail";
  }
  return "prose";
}

/** Derives a whimsical but strictly data-grounded mood for a Desk card's live avatar. */
export function deskMood(desk: Pick<Desk, "state" | "attention" | "lines" | "quiet" | "ci">): DeskMood {
  if (desk.attention === "needs_human" || desk.state === "waiting-input") return "asking";
  if (desk.attention === "stalled") return "stalled";

  if (desk.ci && desk.ci.phases.length > 0) {
    const hasFailed = desk.ci.phases.some((p) => p.status === "failed");
    const hasRunning = desk.ci.phases.some((p) => p.status === "running");
    const allSettled = desk.ci.phases.every((p) => p.status === "passed" || p.status === "skipped");
    if (hasFailed) return "ci-failed";
    if (hasRunning || desk.state === "validating") return "ci-running";
    if (allSettled && (desk.state === "review" || desk.state === "deploying")) {
      return desk.state === "deploying" ? "shipping" : "ci-green";
    }
  }

  if (desk.state === "deploying") return "shipping";
  if (desk.state === "validating") return "ci-running";

  const latest = desk.lines.at(-1)?.trim() ?? "";
  if (latest && !desk.quiet) {
    if (ASKING_RE.test(latest)) return "asking";
    const cmd = classifyLine(latest);
    if (cmd) {
      if (cmd.action === "test") return "testing";
      if (cmd.action === "build" || cmd.action === "typecheck" || cmd.action === "lint" || cmd.action === "install") return "building";
      if (cmd.action === "commit" || cmd.action === "push") return "shipping";
      return "coding";
    }
    if (TEST_PROSE_RE.test(latest)) return "testing";
    if (BUILD_PROSE_RE.test(latest)) return "building";
    return "coding";
  }

  if (desk.state === "running" && !desk.quiet) return "coding";
  return "idle";
}

/** Short human-readable badge text for a live desk mood. */
export const MOOD_LABEL: Record<DeskMood, string> = {
  asking: "NEEDS YOU",
  testing: "TESTING",
  building: "BUILDING",
  shipping: "SHIPPING",
  coding: "CODING",
  "ci-running": "CI LIVE",
  "ci-green": "CI GREEN",
  "ci-failed": "CI RED",
  stalled: "STALLED",
  idle: "STANDBY",
};

/** Returns a beat's visual tone for ticker pips and event ribbons. */
export function beatTone(beat: Beat): Tone {
  const fx = effectFor(beat);
  if (fx) return fx.tone;
  switch (beat.kind) {
    case "item.failed":
      return "bad";
    case "item.needs_human":
    case "item.looped":
    case "gap":
      return "warn";
    case "ci.green":
    case "milestone":
      return "good";
    default:
      return "info";
  }
}

/** Up to `max` CI phases from a live CiMessage, or empty when unavailable. */
export function liveCiPhases(ci: CiMessage | null | undefined, max = 8): CiPhase[] {
  if (!ci?.available || !ci.phases.length) return [];
  return ci.phases.slice(0, max);
}
