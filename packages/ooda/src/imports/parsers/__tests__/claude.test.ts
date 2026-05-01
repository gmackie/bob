import { describe, expect, it } from "vitest";

import { parseClaude } from "../claude.js";

const fixture = [
  {
    id: "conv-1",
    title: "Test conversation",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T01:00:00Z",
    chat_messages: [
      {
        role: "human",
        text: "Hello Claude",
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there!" }],
        timestamp: "2025-01-01T00:01:00Z",
        model: "claude-3-opus",
      },
    ],
  },
];

describe("parseClaude", () => {
  it("parses a valid Claude export array", () => {
    const result = parseClaude(fixture);
    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("claude");
    expect(result[0]!.conversationId).toBe("conv-1");
    expect(result[0]!.title).toBe("Test conversation");
    expect(result[0]!.messages).toHaveLength(2);
    expect(result[0]!.messages[0]!.role).toBe("user");
    expect(result[0]!.messages[0]!.content).toBe("Hello Claude");
    expect(result[0]!.messages[1]!.role).toBe("assistant");
    expect(result[0]!.messages[1]!.content).toBe("Hi there!");
    expect(result[0]!.messages[1]!.model).toBe("claude-3-opus");
  });

  it("parses wrapped { chat_messages } format", () => {
    const result = parseClaude({ chat_messages: fixture });
    expect(result).toHaveLength(1);
    expect(result[0]!.conversationId).toBe("conv-1");
  });

  it("normalizes 'human' role to 'user'", () => {
    const result = parseClaude(fixture);
    expect(result[0]!.messages[0]!.role).toBe("user");
  });

  it("extracts text from content parts including thinking", () => {
    const data = [
      {
        id: "conv-2",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me think..." },
              { type: "text", text: "Here is my answer" },
            ],
          },
        ],
      },
    ];
    const result = parseClaude(data);
    expect(result[0]!.messages[0]!.content).toBe(
      "Let me think...\n\nHere is my answer",
    );
  });

  it("returns empty array for malformed input", () => {
    expect(parseClaude(null)).toEqual([]);
    expect(parseClaude(42)).toEqual([]);
    expect(parseClaude("string")).toEqual([]);
  });

  it("skips messages with no content", () => {
    const data = [
      {
        id: "conv-3",
        messages: [
          { role: "user", text: "" },
          { role: "assistant", text: "response" },
        ],
      },
    ];
    const result = parseClaude(data);
    expect(result[0]!.messages).toHaveLength(1);
    expect(result[0]!.messages[0]!.role).toBe("assistant");
  });
});
