import { describe, expect, it } from "vitest";
import { decodeAnswers, encodeAnswers, parseCommandInput, tierOf, type PendingInput } from "../src";

const pending: PendingInput = {
  attemptId: "a1", promptId: "r1", kind: "user_input", createdAt: "2026-11-15T00:00:00Z",
  questions: [
    { id: "pick", question: "Which?", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
    { id: "many", question: "Which ones?", options: [{ label: "X" }, { label: "Y" }], multiSelect: true },
    { id: "free", question: "Notes?", options: [], multiSelect: false },
  ],
};

describe("decodeAnswers", () => {
  it("round-trips a complete answer", () => {
    const answers = { pick: "A", many: ["X", "Y"], free: "anything" };
    expect(decodeAnswers(encodeAnswers(answers), pending)).toEqual(answers);
    expect(decodeAnswers(encodeAnswers({ pick: "A", many: "X", free: "n" }), pending)).toEqual({ pick: "A", many: "X", free: "n" });
  });
  it.each([
    ["not JSON", "nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["a missing answer", encodeAnswers({ pick: "A", many: "X" })],
    ["an unknown question", encodeAnswers({ pick: "A", many: "X", free: "n", extra: "e" })],
    ["a __proto__ key", '{"pick":"A","many":"X","free":"n","__proto__":"x"}'],
    ["an array for a single-select question", encodeAnswers({ pick: ["A"], many: "X", free: "n" })],
    ["an empty array", encodeAnswers({ pick: "A", many: [], free: "n" })],
    ["an empty string", encodeAnswers({ pick: "", many: "X", free: "n" })],
    ["a non-string value", JSON.stringify({ pick: 1, many: "X", free: "n" })],
    ["an over-long value", encodeAnswers({ pick: "A", many: "X", free: "z".repeat(4001) })],
  ])("rejects %s", (_label, encoded) => {
    expect(decodeAnswers(encoded, pending)).toBeNull();
  });
});

describe("ResolveInput command", () => {
  const input = { itemId: "i1", attemptId: "a1", promptId: "r1", answer: encodeAnswers({ free: "x" }) };
  it("is tier 1", () => {
    expect(tierOf({ operation: "ResolveInput", input })).toBe(1);
  });
  it("parses only the known fields, within limits", () => {
    expect(parseCommandInput("ResolveInput", { ...input, extra: 1 })).toEqual({ operation: "ResolveInput", input });
    expect(parseCommandInput("ResolveInput", { ...input, answer: "" })).toBeNull();
    expect(parseCommandInput("ResolveInput", { ...input, answer: "a".repeat(16001) })).toBeNull();
    expect(parseCommandInput("ResolveInput", { ...input, promptId: "" })).toBeNull();
  });
});
