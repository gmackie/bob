import { describe, expect, it, vi } from "vitest";

import { SpeechCaptureFinalizer } from "./speech-capture-finalizer";

describe("SpeechCaptureFinalizer", () => {
  it("waits for the recognizer end event so a late final result is not lost", async () => {
    const finalizer = new SpeechCaptureFinalizer();
    finalizer.acceptResult({ text: "draft words", isFinal: false, confidence: null });

    const result = finalizer.waitForEnd();
    finalizer.acceptResult({ text: "final words", isFinal: true, confidence: 0.93 });
    finalizer.end();

    await expect(result).resolves.toEqual({ text: "final words", confidence: 0.93 });
  });

  it("combines sequential final results and excludes superseded interim text", async () => {
    const finalizer = new SpeechCaptureFinalizer();
    finalizer.acceptResult({ text: "first sentence", isFinal: true, confidence: 0.91 });
    finalizer.acceptResult({ text: "temporary words", isFinal: false, confidence: null });
    finalizer.acceptResult({ text: "second sentence", isFinal: true, confidence: 0.87 });

    const result = finalizer.waitForEnd();
    finalizer.end();

    await expect(result).resolves.toEqual({
      text: "first sentence second sentence",
      confidence: 0.87,
    });
  });

  it("falls back to the latest transcript if a platform omits the end event", async () => {
    vi.useFakeTimers();
    const finalizer = new SpeechCaptureFinalizer({ endTimeoutMs: 250 });
    finalizer.acceptResult({ text: "still useful", isFinal: false, confidence: null });

    const result = finalizer.waitForEnd();
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toEqual({ text: "still useful", confidence: null });
    vi.useRealTimers();
  });

  it("reset clears transcript state between captures", async () => {
    const finalizer = new SpeechCaptureFinalizer();
    finalizer.acceptResult({ text: "old capture", isFinal: true, confidence: 0.8 });
    finalizer.reset();

    const result = finalizer.waitForEnd();
    finalizer.end();

    await expect(result).resolves.toEqual({ text: "", confidence: null });
  });
});
