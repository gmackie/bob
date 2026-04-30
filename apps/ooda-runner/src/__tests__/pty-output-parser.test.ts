import { describe, expect, it } from "vitest";
import { parsePtyChunk, hasContent, extractAgentResponse } from "../pty-output-parser";

describe("parsePtyChunk", () => {
  it("strips ANSI escape codes", () => {
    expect(parsePtyChunk("\x1B[32mhello\x1B[0m")).toBe("hello");
  });

  it("strips carriage returns", () => {
    expect(parsePtyChunk("hello\r\nworld")).toBe("hello\nworld");
  });
});

describe("hasContent", () => {
  it("returns false for whitespace-only", () => {
    expect(hasContent("  \n  ")).toBe(false);
  });

  it("returns false for ANSI-only", () => {
    expect(hasContent("\x1B[32m\x1B[0m")).toBe(false);
  });

  it("returns true for real content", () => {
    expect(hasContent("Magnesium helps sleep.")).toBe(true);
  });
});

describe("extractAgentResponse", () => {
  it("extracts the final answer after last codex marker", () => {
    const output = [
      "OpenAI Codex v0.116.0",
      "--------",
      "model: gpt-5.4",
      "--------",
      "user",
      "What helps sleep?",
      "codex",
      "I'm checking sources first.",
      "codex",
      "The recommended dose is 200-400mg.",
      "",
      "Sources:",
      "- https://nih.gov/magnesium",
      "",
      "tokens used",
      "5,000",
    ].join("\n");

    const result = extractAgentResponse(output);
    expect(result).toContain("200-400mg");
    expect(result).toContain("https://nih.gov/magnesium");
    expect(result).not.toContain("tokens used");
    expect(result).not.toContain("OpenAI Codex");
    expect(result).not.toContain("checking sources");
  });

  it("strips token count from the end", () => {
    const output = "codex\nHere is the answer.\n\ntokens used\n7,573\n";
    const result = extractAgentResponse(output);
    expect(result).toBe("Here is the answer.");
  });

  it("handles output with ANSI codes", () => {
    const output = "\x1B[35mcodex\x1B[0m\nThe answer is 42.";
    const result = extractAgentResponse(output);
    expect(result).toBe("The answer is 42.");
  });

  it("falls back gracefully when no agent marker found", () => {
    const output = "Just some raw text without markers.";
    const result = extractAgentResponse(output);
    expect(result).toContain("Just some raw text");
  });
});
