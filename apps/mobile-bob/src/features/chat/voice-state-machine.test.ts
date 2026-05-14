import { describe, expect, it } from "vitest";

import type { VoiceGestureSnapshot } from "./voice-state-machine";
import { reduceVoiceGesture } from "./voice-state-machine";

const idle: VoiceGestureSnapshot = {
  phase: "idle",
  transcript: "",
  interimTranscript: "",
};

describe("voice gesture state machine", () => {
  it("records while held and sends the final transcript on release", () => {
    const recording = reduceVoiceGesture(idle, { type: "press" });
    expect(recording.snapshot.phase).toBe("recording");
    expect(recording.effect).toBeNull();

    const released = reduceVoiceGesture(
      {
        phase: "recording",
        transcript: "Ship the auth fix",
        interimTranscript: "",
      },
      { type: "release" },
    );

    expect(released.snapshot.phase).toBe("idle");
    expect(released.effect).toEqual({
      type: "send",
      text: "Ship the auth fix",
    });
  });

  it("locks dictation when the drag passes the lock threshold", () => {
    const locked = reduceVoiceGesture(
      {
        phase: "recording",
        transcript: "",
        interimTranscript: "summarize",
      },
      { type: "drag", translationX: 0, translationY: -72 },
    );

    expect(locked.snapshot.phase).toBe("locked");
    expect(locked.effect).toBeNull();
  });

  it("cancels recording when the drag passes the cancel threshold", () => {
    const cancelled = reduceVoiceGesture(
      {
        phase: "recording",
        transcript: "do not send",
        interimTranscript: "do not send",
      },
      { type: "drag", translationX: -96, translationY: 0 },
    );

    expect(cancelled.snapshot.phase).toBe("idle");
    expect(cancelled.snapshot.transcript).toBe("");
    expect(cancelled.effect).toEqual({ type: "cancel" });
  });
});
