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
