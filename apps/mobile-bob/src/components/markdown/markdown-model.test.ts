import { describe, expect, it } from "vitest";

import {
  looksLikeRawOutput,
  normalizeLinkUrl,
  quoteBlock,
  splitMarkdownBlocks,
} from "./markdown-model";

describe("looksLikeRawOutput", () => {
  it("detects a JSON object", () => {
    expect(looksLikeRawOutput('{"a": 1, "b": [1,2]}')).toBe(true);
  });

  it("detects a JSON array with surrounding whitespace", () => {
    expect(looksLikeRawOutput('  \n[{"id": 1}]\n')).toBe(true);
  });

  it("detects invalid JSON with many key patterns", () => {
    const text = '{"name": "x", "age": 3, "tags": [1,2], trailing';
    expect(looksLikeRawOutput(text)).toBe(true);
  });

  it("detects key patterns outside a leading brace", () => {
    const text = 'output:\n"foo": 1\n"bar": 2\n"baz": 3';
    expect(looksLikeRawOutput(text)).toBe(true);
  });

  it("ignores key patterns past the first 400 chars", () => {
    const text = `${"a".repeat(401)}"x": 1 "y": 2 "z": 3`;
    expect(looksLikeRawOutput(text)).toBe(false);
  });

  it("returns false for prose markdown", () => {
    expect(looksLikeRawOutput("# Title\n\nSome **bold** text.")).toBe(false);
  });

  it("returns false for a bracketed link line", () => {
    expect(looksLikeRawOutput("[link](https://example.com) then text")).toBe(
      false,
    );
  });

  it("returns false for empty input", () => {
    expect(looksLikeRawOutput("")).toBe(false);
    expect(looksLikeRawOutput("   \n")).toBe(false);
  });

  it("returns false for fewer than 3 key patterns", () => {
    expect(looksLikeRawOutput('set "a": 1 and "b": 2')).toBe(false);
  });
});

describe("splitMarkdownBlocks", () => {
  it("returns an empty array for empty input", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
    expect(splitMarkdownBlocks("\n\n")).toEqual([]);
  });

  it("splits paragraphs on blank lines with stable ids", () => {
    const blocks = splitMarkdownBlocks("one\n\ntwo\n\n\nthree");
    expect(blocks.map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
    expect(blocks.map((b) => b.text)).toEqual(["one", "two", "three"]);
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });

  it("keeps a fenced code block containing blank lines as one block", () => {
    const src = "intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\noutro";
    const blocks = splitMarkdownBlocks(src);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toEqual({
      id: "b1",
      kind: "code",
      text: "```ts\nconst a = 1;\n\nconst b = 2;\n```",
    });
    expect(blocks[2]?.text).toBe("outro");
  });

  it("handles tilde fences and unclosed fences", () => {
    const tilde = splitMarkdownBlocks("~~~\nx\n\ny\n~~~");
    expect(tilde).toHaveLength(1);
    expect(tilde[0]?.kind).toBe("code");

    const unclosed = splitMarkdownBlocks("```\nx\n\ny");
    expect(unclosed).toHaveLength(1);
    expect(unclosed[0]?.text).toBe("```\nx\n\ny");
  });

  it("does not treat inline backticks as a fence", () => {
    const blocks = splitMarkdownBlocks("use `foo` here\n\nnext");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("classifies headings", () => {
    const blocks = splitMarkdownBlocks("# Title\n\n## Sub\n\n#hashtag");
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "heading",
      "paragraph",
    ]);
  });

  it("classifies lists (bullet and ordered)", () => {
    const blocks = splitMarkdownBlocks("- a\n- b\n\n* c\n\n1. d\n2. e\n\n3) f");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "list", "list", "list"]);
    expect(blocks[0]?.text).toBe("- a\n- b");
  });

  it("classifies blockquotes", () => {
    const blocks = splitMarkdownBlocks("> quoted\n> more");
    expect(blocks[0]?.kind).toBe("quote");
  });

  it("classifies tables", () => {
    const blocks = splitMarkdownBlocks("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("table");
  });

  it("does not classify a single line with a pipe as a table", () => {
    const blocks = splitMarkdownBlocks("a | b");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("classifies horizontal rules as other", () => {
    const blocks = splitMarkdownBlocks("---\n\n***");
    expect(blocks.map((b) => b.kind)).toEqual(["other", "other"]);
  });

  it("normalizes CRLF line endings", () => {
    const blocks = splitMarkdownBlocks("a\r\n\r\nb");
    expect(blocks.map((b) => b.text)).toEqual(["a", "b"]);
  });
});

describe("quoteBlock", () => {
  it("prefixes each line and appends a trailing blank line", () => {
    expect(quoteBlock("one\ntwo")).toBe("> one\n> two\n\n");
  });

  it("uses a bare marker for empty lines", () => {
    expect(quoteBlock("a\n\nb")).toBe("> a\n>\n> b\n\n");
  });

  it("handles a single line", () => {
    expect(quoteBlock("hello")).toBe("> hello\n\n");
  });

  it("normalizes CRLF", () => {
    expect(quoteBlock("a\r\nb")).toBe("> a\n> b\n\n");
  });
});

describe("normalizeLinkUrl", () => {
  it("passes http and https through", () => {
    expect(normalizeLinkUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeLinkUrl("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
  });

  it("passes mailto through", () => {
    expect(normalizeLinkUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  it("is case-insensitive for schemes", () => {
    expect(normalizeLinkUrl("HTTPS://Example.com")).toBe("HTTPS://Example.com");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("JavaScript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html;base64,AAAA")).toBeNull();
    expect(normalizeLinkUrl("  javascript:alert(1)")).toBeNull();
  });

  it("rejects other unknown schemes", () => {
    expect(normalizeLinkUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeLinkUrl("tel:123")).toBeNull();
  });

  it("prefixes https for bare domains", () => {
    expect(normalizeLinkUrl("example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(normalizeLinkUrl("sub.example.co.uk")).toBe(
      "https://sub.example.co.uk",
    );
    expect(normalizeLinkUrl("example.com:8080/x")).toBe(
      "https://example.com:8080/x",
    );
  });

  it("upgrades protocol-relative urls", () => {
    expect(normalizeLinkUrl("//cdn.example.com/a.js")).toBe(
      "https://cdn.example.com/a.js",
    );
  });

  it("rejects relative paths, anchors, and empty strings", () => {
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("   ")).toBeNull();
    expect(normalizeLinkUrl("/relative/path")).toBeNull();
    expect(normalizeLinkUrl("#anchor")).toBeNull();
    expect(normalizeLinkUrl("just words")).toBeNull();
  });
});
