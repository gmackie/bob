import { describe, expect, it } from "vitest";

import {
  buildStandaloneEmbeddingInput,
  buildStandaloneVaultFingerprint,
  parseLegacyFloat32Embedding,
  parseOllamaEmbeddings,
  resolveStandaloneMigrationRunState,
  STANDALONE_EMBEDDING_INPUT_CHARACTERS,
  STANDALONE_SOURCE_EMBEDDING_DIMENSIONS,
} from "../standalone-vault";

describe("standalone vault migration", () => {
  it("fingerprints the exact source inventory", () => {
    expect(
      buildStandaloneVaultFingerprint({
        sources: 62_293,
        legacyEmbeddings: 62_293,
        topics: 164,
        sourceTopics: 2_558,
        sourceHash: "abc123",
      }),
    ).toBe("standalone-ooda-vault-v1:62293:62293:164:2558:abc123");
  });

  it("accepts only complete finite 768-dimensional Ollama batches", () => {
    const vector = Array.from(
      { length: STANDALONE_SOURCE_EMBEDDING_DIMENSIONS },
      () => 0.25,
    );
    expect(parseOllamaEmbeddings({ embeddings: [vector] }, 1)).toEqual([
      vector,
    ]);
    expect(() =>
      parseOllamaEmbeddings({ embeddings: [vector.slice(1)] }, 1),
    ).toThrow("768-dimension");
    expect(() =>
      parseOllamaEmbeddings({ embeddings: [vector, vector] }, 1),
    ).toThrow("expected 1");
  });

  it("converts legacy little-endian float32 bytes without changing values", () => {
    const bytes = Buffer.alloc(
      STANDALONE_SOURCE_EMBEDDING_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT,
    );
    const expected = Array.from(
      { length: STANDALONE_SOURCE_EMBEDDING_DIMENSIONS },
      (_, index) => (index - 384) / 1_024,
    );
    expected.forEach((value, index) => bytes.writeFloatLE(value, index * 4));

    expect(parseLegacyFloat32Embedding(bytes, 768)).toEqual(expected);
    expect(() => parseLegacyFloat32Embedding(bytes.subarray(4), 768)).toThrow(
      "3072 bytes",
    );
    bytes.writeFloatLE(Number.NaN, 0);
    expect(() => parseLegacyFloat32Embedding(bytes, 768)).toThrow("finite");
  });

  it("bounds embedding input while preserving the source opening and ending", () => {
    expect(buildStandaloneEmbeddingInput("Title", "Body")).toBe(
      "Title\n\nBody",
    );

    const input = buildStandaloneEmbeddingInput(
      "Important title",
      `opening-${"x".repeat(8_000)}-closing`,
    );

    expect(input.length).toBeLessThanOrEqual(
      STANDALONE_EMBEDDING_INPUT_CHARACTERS,
    );
    expect(input).toMatch(/^Important title\n\nopening-/);
    expect(input).toContain("\n\n[...]\n\n");
    expect(input).toMatch(/-closing$/);
  });

  it("clears stale failures after a successful verification", () => {
    expect(resolveStandaloneMigrationRunState(true, true)).toEqual({
      status: "completed",
      phase: "completed",
      lastError: null,
    });
    expect(resolveStandaloneMigrationRunState(true, false)).toEqual({
      status: "embedding",
      phase: "embedding",
      lastError: null,
    });
  });
});
