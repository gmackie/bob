import { describe, expect, it } from "vitest";

import {
  buildStandaloneVaultFingerprint,
  parseOllamaEmbeddings,
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
});
