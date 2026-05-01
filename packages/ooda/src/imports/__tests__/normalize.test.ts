import { describe, expect, it } from "vitest";

import { detectFormat, normalizeImport } from "../normalize.js";

describe("detectFormat", () => {
  it("detects claude from wrapped chat_messages object", () => {
    expect(detectFormat({ chat_messages: [] })).toBe("claude");
  });

  it("detects claude from array with chat_messages entries", () => {
    expect(
      detectFormat([{ uuid: "c1", chat_messages: [] }]),
    ).toBe("claude");
  });

  it("detects chatgpt from mapping key on conversation", () => {
    expect(detectFormat([{ id: "c1", mapping: {} }])).toBe("chatgpt");
  });

  it("detects chatgpt from wrapped conversations object", () => {
    expect(detectFormat({ conversations: [{ id: "c1", mapping: {} }] })).toBe(
      "chatgpt",
    );
  });

  it("detects ooda-native from session_event array", () => {
    expect(
      detectFormat([
        { sessionId: "s1", type: "user", content: "hi" },
      ]),
    ).toBe("ooda-native");
  });

  it("returns null for unrecognized input", () => {
    expect(detectFormat(null)).toBeNull();
    expect(detectFormat(42)).toBeNull();
    expect(detectFormat("string")).toBeNull();
    expect(detectFormat({ unrelated: true })).toBeNull();
  });
});

describe("normalizeImport", () => {
  it("routes claude input through parseClaude", () => {
    const result = normalizeImport([
      {
        id: "conv-1",
        title: "Hello",
        chat_messages: [
          { role: "human", text: "hi" },
          { role: "assistant", text: "there" },
        ],
      },
    ]);
    expect(result.format).toBe("claude");
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.provider).toBe("claude");
  });

  it("routes ooda-native input through parseOodaNative", () => {
    const result = normalizeImport([
      { sessionId: "s1", type: "user", content: "hi" },
      { sessionId: "s1", type: "assistant", content: "hello" },
    ]);
    expect(result.format).toBe("ooda-native");
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.provider).toBe("ooda-native");
  });

  it("throws when format is unknown", () => {
    expect(() => normalizeImport({ unrelated: true })).toThrow(
      /Unrecognized/i,
    );
  });
});
