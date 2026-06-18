import { describe, expect, it } from "vitest";

import { parseChatGPT } from "../chatgpt.js";

const mappingFixture = [
  {
    conversation_id: "abc-123",
    title: "ChatGPT conversation",
    create_time: 1704067200,
    update_time: 1704070800,
    mapping: {
      "node-1": {
        message: {
          author: { role: "user" },
          content: { parts: ["What is 2+2?"] },
          create_time: 1704067200,
          metadata: {},
        },
      },
      "node-2": {
        message: {
          author: { role: "assistant" },
          content: { parts: ["2+2 equals 4."] },
          create_time: 1704067260,
          metadata: { model_slug: "gpt-4" },
        },
      },
      "node-root": {
        message: null,
      },
    },
  },
];

const simpleFixture = [
  {
    id: "simple-1",
    title: "Simple format",
    messages: [
      { role: "user", content: "Hi", timestamp: "2025-01-01T00:00:00Z" },
      {
        role: "assistant",
        content: "Hello!",
        timestamp: "2025-01-01T00:01:00Z",
        model: "gpt-4",
      },
    ],
  },
];

describe("parseChatGPT", () => {
  it("parses mapping-based conversations", () => {
    const result = parseChatGPT(mappingFixture);
    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("chatgpt");
    expect(result[0]!.conversationId).toBe("abc-123");
    expect(result[0]!.title).toBe("ChatGPT conversation");
    expect(result[0]!.messages).toHaveLength(2);
    expect(result[0]!.messages[0]!.role).toBe("user");
    expect(result[0]!.messages[0]!.content).toBe("What is 2+2?");
    expect(result[0]!.messages[1]!.role).toBe("assistant");
    expect(result[0]!.messages[1]!.model).toBe("gpt-4");
  });

  it("orders mapping messages by create_time", () => {
    const result = parseChatGPT(mappingFixture);
    const [first, second] = result[0]!.messages;
    expect(first!.role).toBe("user");
    expect(second!.role).toBe("assistant");
  });

  it("parses simple message array format", () => {
    const result = parseChatGPT(simpleFixture);
    expect(result).toHaveLength(1);
    expect(result[0]!.messages).toHaveLength(2);
    expect(result[0]!.messages[0]!.content).toBe("Hi");
  });

  it("parses wrapped { conversations } format", () => {
    const result = parseChatGPT({ conversations: simpleFixture });
    expect(result).toHaveLength(1);
    expect(result[0]!.conversationId).toBe("simple-1");
  });

  it("normalizes unix timestamps to ISO strings", () => {
    const result = parseChatGPT(mappingFixture);
    expect(result[0]!.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(result[0]!.updatedAt).toBe("2024-01-01T01:00:00Z");
  });

  it("returns empty array for malformed input", () => {
    expect(parseChatGPT(null)).toEqual([]);
    expect(parseChatGPT(42)).toEqual([]);
    expect(parseChatGPT("string")).toEqual([]);
  });

  it("skips mapping nodes with null message", () => {
    const result = parseChatGPT(mappingFixture);
    // node-root has message: null, so only 2 messages
    expect(result[0]!.messages).toHaveLength(2);
  });
});
