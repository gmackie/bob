import { describe, expect, it } from "vitest";

import { transcriptDisposition } from "./transcript-review";

describe("voice transcript review", () => {
  it("sends a confident final transcript without adding friction", () => {
    expect(transcriptDisposition({ text: "This is clear", confidence: 0.94 })).toEqual({
      action: "send",
      text: "This is clear",
    });
  });

  it("opens an editable review for a low-confidence transcript", () => {
    expect(transcriptDisposition({ text: "maybe recipe", confidence: 0.41 })).toEqual({
      action: "review",
      text: "maybe recipe",
      reason: "low_confidence",
    });
  });

  it("sends transcripts when the recognizer cannot report confidence (Apple on-device dictation)", () => {
    // SFSpeechRecognizer on-device returns 0/null confidence on finals; that
    // is the normal case, so trust and send rather than forcing review.
    expect(transcriptDisposition({ text: "unrated result", confidence: -1 })).toEqual({
      action: "send",
      text: "unrated result",
    });
    expect(transcriptDisposition({ text: "zero conf", confidence: 0 })).toEqual({
      action: "send",
      text: "zero conf",
    });
    expect(transcriptDisposition({ text: "null conf", confidence: null })).toEqual({
      action: "send",
      text: "null conf",
    });
  });

  it("discards empty recognition results", () => {
    expect(transcriptDisposition({ text: "   ", confidence: 0.99 })).toEqual({
      action: "discard",
    });
  });
});
