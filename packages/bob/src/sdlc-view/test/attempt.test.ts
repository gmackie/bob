import { describe, expect, it } from "vitest";
import { decodeAnswers, encodeAnswers, parseCommandInput, stripTerminalControls, tierOf, type PendingInput } from "../src";

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
    ["a value that is not an option", encodeAnswers({ pick: "C", many: "X", free: "n" })],
    ["a multiSelect value that is not an option", encodeAnswers({ pick: "A", many: ["X", "Z"], free: "n" })],
  ])("rejects %s", (_label, encoded) => {
    expect(decodeAnswers(encoded, pending)).toBeNull();
  });
});

describe("decodeAnswers option values", () => {
  const valued: PendingInput = { ...pending, questions: [{ id: "q", question: "Stage?", options: [{ label: "Staging", value: "staging" }, { label: "Prod" }], multiSelect: false }] };
  it("accepts value ?? label and refuses the label of an option that has a value", () => {
    expect(decodeAnswers(encodeAnswers({ q: "staging" }), valued)).toEqual({ q: "staging" });
    expect(decodeAnswers(encodeAnswers({ q: "Prod" }), valued)).toEqual({ q: "Prod" });
    expect(decodeAnswers(encodeAnswers({ q: "Staging" }), valued)).toBeNull();
  });
});

describe("stripTerminalControls", () => {
  it("removes whole CSI, OSC and DCS sequences, 7- and 8-bit, and other C0/C1 controls", () => {
    expect(stripTerminalControls("\u001b[31mred\u001b[0m")).toBe("red");
    expect(stripTerminalControls("a\u001b]8;;https://evil.test\u0007link\u001b]8;;\u0007b")).toBe("alinkb");
    expect(stripTerminalControls("a\u001b]0;title\u001b\\b")).toBe("ab");
    expect(stripTerminalControls("a\u009b2Jb\u009d0;t\u009cc")).toBe("abc");
    expect(stripTerminalControls("a\u001bPq#0\u001b\\b")).toBe("ab");
    expect(stripTerminalControls("a\u001b(Bb\u001bc\u0007\u0000\u007f\u0085z")).toBe("abz");
    expect(stripTerminalControls("x\u001b")).toBe("x");
  });
  it("keeps tabs; line breaks become spaces, or LF when multiline", () => {
    expect(stripTerminalControls("a\tb\r\nc\rd")).toBe("a\tb c d");
    expect(stripTerminalControls("a\r\nb\u001b[2Kc", { multiline: true })).toBe("a\nbc");
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
