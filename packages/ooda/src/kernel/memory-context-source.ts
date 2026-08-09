import type {
  MemorySearchInputV1,
  MemorySearchPageV1,
  MemorySeedV1,
} from "../contracts/v1";
import type {
  ContextCandidate,
  ConversationContextSource,
} from "./context-sources";

export type MemoryContextSearch = (
  input: MemorySearchInputV1,
) => Promise<MemorySearchPageV1>;

export type MemoryContextSourceOptions = {
  search: MemoryContextSearch;
  excludeConversationId?: string;
};

const INACTIVE_STATES = new Set(["dismissed", "merged", "killed"]);
const QUERY_STOP_WORDS = new Set([
  "about",
  "and",
  "for",
  "from",
  "have",
  "into",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "will",
  "with",
  "your",
]);

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3 && !QUERY_STOP_WORDS.has(term)),
    ),
  ].slice(0, 4);
}

function relevance(memory: MemorySeedV1, terms: string[]): number {
  const content = memory.normalizedText.toLowerCase();
  return terms.reduce(
    (score, term) => score + (content.includes(term) ? 1 : 0),
    0,
  );
}

function candidate(memory: MemorySeedV1): ContextCandidate {
  return {
    sourceType: "memory_seed",
    sourceId: memory.id,
    sensitivity: memory.sensitivity,
    content: [memory.kind, memory.lifecycleState, memory.normalizedText].join(
      " | ",
    ),
  };
}

export function createMemoryContextSource(
  options: MemoryContextSourceOptions,
): ConversationContextSource {
  return {
    id: "memory",
    async inspect({ query, limitPerSource, signal }) {
      const terms = queryTerms(query);
      if (terms.length === 0) return [];
      if (signal?.aborted) throw signal.reason;
      const pages = await Promise.all(
        terms.map((term) =>
          options.search({
            query: term,
            includeSuperseded: false,
            limit: Math.min(100, Math.max(limitPerSource * 4, 20)),
          }),
        ),
      );
      if (signal?.aborted) throw signal.reason;

      const byId = new Map<string, MemorySeedV1>();
      for (const memory of pages.flatMap((page) => page.items)) {
        if (
          memory.conversationId === options.excludeConversationId ||
          INACTIVE_STATES.has(memory.lifecycleState)
        ) {
          continue;
        }
        byId.set(memory.id, memory);
      }
      return [...byId.values()]
        .sort(
          (left, right) =>
            relevance(right, terms) - relevance(left, terms) ||
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limitPerSource)
        .map(candidate);
    },
  };
}
