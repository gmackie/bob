import { describe, expect, it } from "vitest";

import { readSseMessages } from "./ooda-sse";

describe("readSseMessages", () => {
  it("parses complete named SSE messages", () => {
    const result = readSseMessages(
      'event: session_output\ndata: {"session_id":"s1","type":"stdout_chunk"}\n\n',
    );

    expect(result.rest).toBe("");
    expect(result.messages).toEqual([
      {
        event: "session_output",
        data: '{"session_id":"s1","type":"stdout_chunk"}',
      },
    ]);
  });

  it("keeps partial messages as rest", () => {
    const result = readSseMessages("event: session_output\ndata: {");

    expect(result.messages).toEqual([]);
    expect(result.rest).toBe("event: session_output\ndata: {");
  });

  it("joins multiline data fields", () => {
    const result = readSseMessages("event: message\ndata: hello\ndata: world\n\n");

    expect(result.messages).toEqual([
      {
        event: "message",
        data: "hello\nworld",
      },
    ]);
  });
});
