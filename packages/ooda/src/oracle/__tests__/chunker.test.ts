import { describe, expect, it } from "vitest";
import { encode } from "gpt-tokenizer/model/gpt-4o";

import { chunkSource } from "../chunker.js";

describe("chunkSource", () => {
  it("returns empty array for empty body", () => {
    const chunks = chunkSource({ sourceId: 1, body: "" });
    expect(chunks).toEqual([]);
  });

  it("returns a single chunk for short content", () => {
    const chunks = chunkSource({ sourceId: 1, body: "Hello world" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sourceId).toBe(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.content).toBe("Hello world");
    expect(chunks[0]!.tokenCount).toBe(encode("Hello world").length);
  });

  it("preserves heading context", () => {
    const introText = "This is the intro paragraph. ".repeat(40);
    const methodsText = "This is the methods section. ".repeat(40);
    const body = `# Introduction

${introText}

# Methods

${methodsText}`;

    const chunks = chunkSource({ sourceId: 1, body }, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);

    const methodsChunk = chunks.find((c) => c.content.includes("methods section"));
    expect(methodsChunk).toBeDefined();
    expect(methodsChunk!.headingContext).toBe("Methods");
  });

  it("splits long content into multiple chunks", () => {
    const paragraph = "This is a test paragraph with enough words to generate some tokens. ".repeat(50);
    const body = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;

    const chunks = chunkSource({ sourceId: 1, body }, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
      expect(chunks[i]!.sourceId).toBe(1);
    }
  });

  it("assigns sequential chunk indices", () => {
    const paragraph = "Word ".repeat(200);
    const body = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;

    const chunks = chunkSource({ sourceId: 1, body }, 50, 10);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.chunkIndex).toBe(i);
    }
  });

  it("passes through contentAsOf", () => {
    const date = new Date("2025-06-01");
    const chunks = chunkSource({
      sourceId: 1,
      body: "Some content",
      contentAsOf: date,
    });
    expect(chunks[0]!.contentAsOf).toEqual(date);
  });

  it("sets contentAsOf to null when not provided", () => {
    const chunks = chunkSource({ sourceId: 1, body: "Some content" });
    expect(chunks[0]!.contentAsOf).toBeNull();
  });

  it("handles content with only headings", () => {
    const body = `# Heading One

# Heading Two

# Heading Three`;
    const chunks = chunkSource({ sourceId: 1, body });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("uses sliding window for oversized blocks", () => {
    const longBlock = "word ".repeat(1000);
    const chunks = chunkSource({ sourceId: 1, body: longBlock }, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });
});
