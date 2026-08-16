import type { MemoryConnectionV1, MemorySeedV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import {
  buildMemorySearchInput,
  buildMemorySearchSummary,
  sortMemoryConnections,
} from "./memory-search-model";

function memory(
  id: string,
  kind: MemorySeedV1["kind"],
  lifecycleState: MemorySeedV1["lifecycleState"],
): MemorySeedV1 {
  return {
    id,
    conversationId: "conversation-1",
    kind,
    sourceEventId: `event-${id}`,
    sourceSpan: { start: 0, end: 1 },
    normalizedText: `Memory ${id}`,
    entities: [],
    sensitivity: "personal",
    confidence: 0.9,
    lifecycleState,
    createdAt: "2026-08-16T12:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
}

describe("mobile memory search model", () => {
  it("trims a query and requests the largest bounded page", () => {
    expect(buildMemorySearchInput("  venture idea  ")).toEqual({
      query: "venture idea",
      limit: 100,
    });
  });

  it("omits a blank query so the API returns recent memories", () => {
    expect(buildMemorySearchInput("   ")).toEqual({ limit: 100 });
  });

  it("summarizes results by lifecycle and kind deterministically", () => {
    expect(
      buildMemorySearchSummary([
        memory("3", "question", "captured"),
        memory("2", "idea", "incubating"),
        memory("1", "idea", "captured"),
      ]),
    ).toEqual({
      total: 3,
      lifecycle: [
        { label: "captured", count: 2 },
        { label: "incubating", count: 1 },
      ],
      kinds: [
        { label: "idea", count: 2 },
        { label: "question", count: 1 },
      ],
    });
  });

  it("orders inspected connections by relevance without mutating the receipt", () => {
    const low: MemoryConnectionV1 = {
      direction: "incoming",
      edge: {
        id: "edge-low",
        fromMemoryId: "memory-2",
        toMemoryId: "memory-1",
        kind: "semantic",
        score: 0.4,
        explanation: "A loose connection",
        discoveryMethod: "embedding",
        feedbackState: "unreviewed",
        createdAt: "2026-08-16T12:00:00.000Z",
        updatedAt: "2026-08-16T12:00:00.000Z",
      },
      memory: memory("2", "idea", "captured"),
    };
    const high: MemoryConnectionV1 = {
      ...low,
      direction: "outgoing",
      edge: {
        ...low.edge,
        id: "edge-high",
        score: 0.9,
        explanation: "A strong connection",
      },
      memory: memory("3", "question", "enriched"),
    };
    const receipt = [low, high];

    expect(sortMemoryConnections(receipt).map(({ edge }) => edge.id)).toEqual([
      "edge-high",
      "edge-low",
    ]);
    expect(receipt.map(({ edge }) => edge.id)).toEqual([
      "edge-low",
      "edge-high",
    ]);
  });
});
