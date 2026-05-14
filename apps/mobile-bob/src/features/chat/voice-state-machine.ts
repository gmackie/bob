export type VoiceGesturePhase = "idle" | "recording" | "locked";

export interface VoiceGestureSnapshot {
  phase: VoiceGesturePhase;
  transcript: string;
  interimTranscript: string;
}

export type VoiceGestureAction =
  | { type: "press" }
  | { type: "release" }
  | { type: "tapLocked" }
  | { type: "cancel" }
  | { type: "drag"; translationX: number; translationY: number }
  | { type: "transcript"; transcript: string; interimTranscript: string };

export type VoiceGestureEffect =
  | { type: "send"; text: string }
  | { type: "cancel" };

export interface VoiceGestureReduction {
  snapshot: VoiceGestureSnapshot;
  effect: VoiceGestureEffect | null;
}

const LOCK_THRESHOLD_Y = -56;
const CANCEL_THRESHOLD_X = -72;

function idleSnapshot(): VoiceGestureSnapshot {
  return {
    phase: "idle",
    transcript: "",
    interimTranscript: "",
  };
}

function combinedTranscript(snapshot: VoiceGestureSnapshot): string {
  return [snapshot.transcript, snapshot.interimTranscript]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function finish(snapshot: VoiceGestureSnapshot): VoiceGestureReduction {
  const text = combinedTranscript(snapshot);
  return {
    snapshot: idleSnapshot(),
    effect: text ? { type: "send", text } : null,
  };
}

export function reduceVoiceGesture(
  snapshot: VoiceGestureSnapshot,
  action: VoiceGestureAction,
): VoiceGestureReduction {
  switch (action.type) {
    case "press":
      return {
        snapshot: { ...snapshot, phase: "recording" },
        effect: null,
      };
    case "release":
      return snapshot.phase === "recording"
        ? finish(snapshot)
        : { snapshot, effect: null };
    case "tapLocked":
      return snapshot.phase === "locked"
        ? finish(snapshot)
        : { snapshot, effect: null };
    case "cancel":
      return {
        snapshot: idleSnapshot(),
        effect: { type: "cancel" },
      };
    case "drag":
      if (snapshot.phase !== "recording") {
        return { snapshot, effect: null };
      }
      if (action.translationX <= CANCEL_THRESHOLD_X) {
        return {
          snapshot: idleSnapshot(),
          effect: { type: "cancel" },
        };
      }
      if (action.translationY <= LOCK_THRESHOLD_Y) {
        return {
          snapshot: { ...snapshot, phase: "locked" },
          effect: null,
        };
      }
      return { snapshot, effect: null };
    case "transcript":
      return {
        snapshot: {
          ...snapshot,
          transcript: action.transcript,
          interimTranscript: action.interimTranscript,
        },
        effect: null,
      };
  }
}
