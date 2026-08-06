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

  it("reviews transcripts when the recognizer cannot report confidence", () => {
    expect(transcriptDisposition({ text: "unrated result", confidence: -1 })).toMatchObject({
      action: "review",
      reason: "confidence_unavailable",
    });
  });

  it("discards empty recognition results", () => {
    expect(transcriptDisposition({ text: "   ", confidence: 0.99 })).toEqual({
      action: "discard",
    });
  });
});
