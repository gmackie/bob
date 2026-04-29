import { describe, expect, it } from "vitest";

import { parseOodaNative } from "../ooda-native.js";

const fixture = [
  {
    id: "evt-1",
    sessionId: "session-aaa",
    type: "user",
    content: "Research quantum computing basics",
    createdAt: "2025-01-01T00:00:00Z",
  },
  {
    id: "evt-2",
    sessionId: "session-aaa",
    type: "assistant",
    content: "Quantum computing uses qubits...",
    createdAt: "2025-01-01T00:01:00Z",
  },
  {
    id: "evt-3",
    sessionId: "session-bbb",
    type: "human",
    content: "Compare transformers vs RNNs",
    createdAt: "2025-01-02T00:00:00Z",
  },
  {
    id: "evt-4",
    sessionId: "session-bbb",
    type: "ai",
    content: "Transformers use self-attention...",
    createdAt: "2025-01-02T00:01:00Z",
  },
];

describe("parseOodaNative", () => {
  it("groups events by sessionId into conversations", () => {
    const result = parseOodaNative(fixture);
    expect(result).toHaveLength(2);
  });

  it("maps session event types to roles correctly", () => {
    const result = parseOodaNative(fixture);
    const sessionA = result.find((c) => c.conversationId === "session-aaa")!;
    expect(sessionA.messages[0]!.role).toBe("user");
    expect(sessionA.messages[1]!.role).toBe("assistant");

    const sessionB = result.find((c) => c.conversationId === "session-bbb")!;
    expect(sessionB.messages[0]!.role).toBe("user"); // "human" -> "user"
    expect(sessionB.messages[1]!.role).toBe("assistant"); // "ai" -> "assistant"
  });

  it("sets provider to ooda-native", () => {
    const result = parseOodaNative(fixture);
    expect(result[0]!.provider).toBe("ooda-native");
  });

  it("derives title from first user message", () => {
    const result = parseOodaNative(fixture);
    const sessionA = result.find((c) => c.conversationId === "session-aaa")!;
    expect(sessionA.title).toBe("Research quantum computing basics");
  });

  it("sorts messages by createdAt within a session", () => {
    const outOfOrder = [
      {
        sessionId: "s1",
        type: "assistant",
        content: "Response",
        createdAt: "2025-01-01T00:01:00Z",
      },
      {
        sessionId: "s1",
        type: "user",
        content: "Question",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];
    const result = parseOodaNative(outOfOrder);
    expect(result[0]!.messages[0]!.role).toBe("user");
    expect(result[0]!.messages[1]!.role).toBe("assistant");
  });

  it("skips events with empty content", () => {
    const data = [
      {
        sessionId: "s2",
        type: "user",
        content: "",
        createdAt: "2025-01-01T00:00:00Z",
      },
      {
        sessionId: "s2",
        type: "assistant",
        content: "Something",
        createdAt: "2025-01-01T00:01:00Z",
      },
    ];
    const result = parseOodaNative(data);
    expect(result[0]!.messages).toHaveLength(1);
  });

  it("returns empty array for malformed input", () => {
    expect(parseOodaNative(null)).toEqual([]);
    expect(parseOodaNative(42)).toEqual([]);
    expect(parseOodaNative("string")).toEqual([]);
    expect(parseOodaNative({ not: "an array" })).toEqual([]);
  });

  it("sets createdAt and updatedAt from first/last event timestamps", () => {
    const result = parseOodaNative(fixture);
    const sessionA = result.find((c) => c.conversationId === "session-aaa")!;
    expect(sessionA.createdAt).toBe("2025-01-01T00:00:00Z");
    expect(sessionA.updatedAt).toBe("2025-01-01T00:01:00Z");
  });
});
