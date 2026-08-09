import { describe, expect, it } from "vitest";

import { deriveMemoryCapture } from "../memory-capture";

describe("deriveMemoryCapture", () => {
  it("preserves a complete whimsical question with its exact source span", () => {
    expect(
      deriveMemoryCapture({
        type: "user_turn",
        payload: { display: "Could a greenhouse regulate itself with mushrooms?" },
      }),
    ).toEqual({
      kind: "question",
      normalizedText: "Could a greenhouse regulate itself with mushrooms?",
      sourceSpan: { start: 0, end: 50 },
      confidence: 0.98,
      entities: ["greenhouse", "mushrooms"],
    });
  });

  it("classifies an explicit project idea without turning it into a commitment", () => {
    expect(
      deriveMemoryCapture({
        type: "user_turn",
        payload: { display: "What if we build a recipe planner for the vault" },
      }),
    ).toMatchObject({
      kind: "idea",
      normalizedText: "What if we build a recipe planner for the vault",
    });
  });

  it("captures a correction from its replacement payload", () => {
    expect(
      deriveMemoryCapture({
        type: "correction",
        payload: {
          correctedEventId: "event-1",
          replacementPayload: { display: "Meditation is at 7am, not 8am." },
        },
      }),
    ).toMatchObject({
      kind: "correction",
      normalizedText: "Meditation is at 7am, not 8am.",
    });
  });

  it("does not manufacture memory from tool or assistant events", () => {
    expect(
      deriveMemoryCapture({ type: "assistant_turn", payload: { display: "Answer" } }),
    ).toBeNull();
    expect(
      deriveMemoryCapture({ type: "tool_result", payload: { content: "Result" } }),
    ).toBeNull();
  });
});
