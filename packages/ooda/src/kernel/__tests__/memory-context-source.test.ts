import { describe, expect, it, vi } from "vitest";

import type {
  MemorySearchInputV1,
  MemorySearchPageV1,
  MemorySeedV1,
} from "../../contracts/v1";
import { createMemoryContextSource } from "../memory-context-source";

const now = "2026-08-09T00:00:00.000Z";

function memory(
  id: string,
  conversationId: string,
  normalizedText: string,
  overrides: Partial<MemorySeedV1> = {},
): MemorySeedV1 {
  return {
    id,
    conversationId,
    kind: "idea",
    sourceEventId: `event-${id}`,
    sourceSpan: { start: 0, end: normalizedText.length },
    normalizedText,
    entities: [],
    sensitivity: "general",
    confidence: 0.9,
    lifecycleState: "captured",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("createMemoryContextSource", () => {
  it("recalls relevant past memories without duplicating the active conversation", async () => {
    const past = memory(
      "memory-past",
      "conversation-past",
      "Use voice brainstorming to create well-scoped Bob tasks.",
    );
    const current = memory(
      "memory-current",
      "conversation-current",
      "Current voice brainstorming turn.",
    );
    const sensitive = memory(
      "memory-sensitive",
      "conversation-private",
      "Voice notes about a private diet experiment.",
      { sensitivity: "sensitive" },
    );
    const search = vi.fn(
      async (input: MemorySearchInputV1): Promise<MemorySearchPageV1> => ({
        items:
          input.query === "voice"
            ? [current, past, sensitive]
            : input.query === "brainstorming" || input.query === "bob"
              ? [past]
              : [],
        pageInfo: { hasMore: false },
      }),
    );
    const source = createMemoryContextSource({
      search,
      excludeConversationId: "conversation-current",
    });

    const candidates = await source.inspect({
      query: "Voice brainstorming for Bob",
      limitPerSource: 5,
    });

    expect(search).toHaveBeenCalledTimes(3);
    expect(candidates.map(({ sourceId }) => sourceId)).toEqual([
      "memory-past",
      "memory-sensitive",
    ]);
    expect(candidates[0]).toMatchObject({
      sourceType: "memory_seed",
      sensitivity: "general",
      content: expect.stringContaining("well-scoped Bob tasks"),
    });
    expect(candidates[1]).toMatchObject({
      sourceType: "memory_seed",
      sensitivity: "sensitive",
    });
  });
});
