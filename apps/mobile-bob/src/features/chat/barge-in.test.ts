import { describe, expect, it } from "vitest";

import { beginVoiceCapture } from "./barge-in";

describe("voice barge-in", () => {
  it("fully stops spoken playback before opening the microphone", async () => {
    const order: string[] = [];

    await beginVoiceCapture({
      stopPlayback: async () => {
        order.push("stop:start");
        await Promise.resolve();
        order.push("stop:done");
      },
      startRecognition: () => {
        order.push("recognition:start");
      },
    });

    expect(order).toEqual(["stop:start", "stop:done", "recognition:start"]);
  });

  it("does not start recognition when playback cannot be stopped", async () => {
    let recognitionStarted = false;

    await expect(beginVoiceCapture({
      stopPlayback: () => Promise.reject(new Error("audio session busy")),
      startRecognition: () => {
        recognitionStarted = true;
      },
    })).rejects.toThrow("audio session busy");
    expect(recognitionStarted).toBe(false);
  });
});
