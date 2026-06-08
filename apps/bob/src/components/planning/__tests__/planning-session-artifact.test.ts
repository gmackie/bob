import { describe, expect, it } from "vitest";

import { extractPlanningArtifactContent } from "../planning-session-artifact";

describe("planning session artifact extraction", () => {
  it("extracts readable assistant content from structured planning session events", () => {
    const content = extractPlanningArtifactContent([
      {
        seq: 1,
        direction: "agent",
        eventType: "output_chunk",
        payload: {
          data: {
            type: "response.output_text.delta",
            delta: "Draft the implementation plan.",
          },
        },
      },
      {
        seq: 2,
        direction: "agent",
        eventType: "message_final",
        payload: {
          content: {
            message: {
              content: [
                { type: "text", text: "\n# Plan\n\n1. Update the dashboard." },
              ],
            },
          },
        },
      },
    ]);

    expect(content).toBe("Draft the implementation plan.\n# Plan\n\n1. Update the dashboard.");
    expect(content).not.toContain("{");
    expect(content).not.toContain("response.output_text.delta");
  });
});
