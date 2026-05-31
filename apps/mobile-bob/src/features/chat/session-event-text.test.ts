import { describe, expect, it } from "vitest";

import { extractSessionEventText } from "./session-event-text";

describe("session event text extraction", () => {
  it("extracts assistant text from JSONL stdout chunks", () => {
    const text = extractSessionEventText("output_chunk", {
      data: [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "I found the failing endpoint." }],
          },
        }),
        JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: " It is fixed now." },
        }),
      ].join("\n"),
    });

    expect(text).toBe("I found the failing endpoint. It is fixed now.");
  });

  it("does not expose raw JSON when an agent event has no display text", () => {
    const text = extractSessionEventText("output_chunk", {
      data: JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session-1",
      }),
    });

    expect(text).toBe("");
  });

  it("extracts text from array-wrapped agent events instead of showing JSON", () => {
    const text = extractSessionEventText("output_chunk", {
      data: JSON.stringify([
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Reading the current queue." },
        },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: " Starting the next task." },
        },
      ]),
    });

    expect(text).toBe("Reading the current queue. Starting the next task.");
  });

  it("extracts text from nested payload data", () => {
    const text = extractSessionEventText("message_final", {
      data: {
        message: {
          content: [{ type: "text", text: "The session is now running." }],
        },
      },
    });

    expect(text).toBe("The session is now running.");
  });

  it("extracts readable error messages", () => {
    expect(
      extractSessionEventText("error", {
        code: "AGENT_ERROR",
        message: "Agent exited with code 1",
      }),
    ).toBe("AGENT_ERROR: Agent exited with code 1");
  });
});
