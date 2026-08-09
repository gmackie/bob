import { describe, expect, it } from "vitest";

import { parseGrok } from "../grok.js";
import { normalizeImport } from "../../normalize.js";

describe("parseGrok", () => {
  it("parses a single conversation with role/content messages", () => {
    const convs = parseGrok({
      title: "Rocket engines",
      messages: [
        { role: "user", content: "How do aerospike nozzles work?" },
        { role: "assistant", content: "They stay efficient across altitudes." },
      ],
    });
    expect(convs).toHaveLength(1);
    expect(convs[0]!.provider).toBe("grok");
    expect(convs[0]!.title).toBe("Rocket engines");
    expect(convs[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("parses a flat array of messages", () => {
    const convs = parseGrok([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    expect(convs).toHaveLength(1);
    expect(convs[0]!.messages).toHaveLength(2);
    expect(convs[0]!.messages[1]!.role).toBe("assistant");
  });

  it("handles sender/text fields and Grok-style roles (AGENT/USER)", () => {
    const convs = parseGrok({
      messages: [
        { sender: "USER", text: "hi" },
        { sender: "AGENT", text: "hello" },
      ],
    });
    expect(convs[0]!.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("handles author.role + content.parts (OpenAI-ish) shape", () => {
    const convs = parseGrok({
      messages: [
        { author: { role: "user" }, content: { parts: ["question"] } },
        { author: { role: "assistant" }, content: { parts: ["answer"] } },
      ],
    });
    expect(convs[0]!.messages[0]!.content).toBe("question");
    expect(convs[0]!.messages[1]!.role).toBe("assistant");
  });

  it("unwraps a { conversations: [...] } envelope", () => {
    const convs = parseGrok({
      conversations: [
        { title: "A", messages: [{ role: "user", content: "x" }] },
        { title: "B", messages: [{ role: "user", content: "y" }] },
      ],
    });
    expect(convs).toHaveLength(2);
    expect(convs.map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("reads alternate message container keys (history/turns)", () => {
    const convs = parseGrok({
      history: [
        { role: "user", content: "q" },
        { role: "grok", content: "a" },
      ],
    });
    expect(convs[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("parseGrok — real account export (prod-grok-backend)", () => {
  const backend = {
    conversations: [
      {
        conversation: {
          id: "3fce291c-331b-4e90-ab32-ca1629034399",
          title: "Enterprise AI Pricing",
          create_time: "2026-08-06T11:49:24.823545Z",
        },
        responses: [
          {
            response: {
              _id: "a1",
              message: "what is enterprise ai pricing?",
              sender: "human",
              create_time: { $date: { $numberLong: "1786016990579" } },
            },
          },
          {
            response: {
              _id: "a2",
              message: "Direct agreements exist with the model vendors.",
              sender: "ASSISTANT",
              create_time: { $date: { $numberLong: "1786016995000" } },
            },
          },
          // A response with no message (tool/empty) is skipped.
          { response: { _id: "a3", message: "", sender: "assistant" } },
        ],
      },
    ],
  };

  it("parses the nested conversation/responses shape", () => {
    const convs = parseGrok(backend);
    expect(convs).toHaveLength(1);
    expect(convs[0]!.provider).toBe("grok");
    expect(convs[0]!.title).toBe("Enterprise AI Pricing");
    expect(convs[0]!.conversationId).toBe(
      "3fce291c-331b-4e90-ab32-ca1629034399",
    );
    // 2 messages (the empty one is dropped); sender human→user, ASSISTANT→assistant
    expect(convs[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(convs[0]!.messages[0]!.content).toBe(
      "what is enterprise ai pricing?",
    );
  });

  it("converts Mongo $date timestamps to ISO", () => {
    const convs = parseGrok(backend);
    expect(convs[0]!.messages[0]!.timestamp).toBe(
      new Date(1786016990579).toISOString(),
    );
    expect(convs[0]!.createdAt).toBe("2026-08-06T11:49:24.823545Z");
  });

  it("normalizeImport detects the backend export as grok, not chatgpt", () => {
    const { format, conversations } = normalizeImport(backend);
    expect(format).toBe("grok");
    expect(conversations[0]!.messages).toHaveLength(2);
  });
});

describe("normalizeImport with grok fallback", () => {
  it("detects a generic conversation as grok", () => {
    const { format, conversations } = normalizeImport({
      title: "T",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(format).toBe("grok");
    expect(conversations).toHaveLength(1);
  });

  it("does not hijack a ChatGPT export", () => {
    const { format } = normalizeImport({ mapping: {} });
    expect(format).toBe("chatgpt");
  });

  it("still rejects non-conversation junk", () => {
    expect(() => normalizeImport({ random: "junk" })).toThrow();
  });
});
