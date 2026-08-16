import type {
  MemoryConnectionV1,
  MemorySearchInputV1,
  MemorySeedV1,
} from "@gmacko/ooda-client/v1";

const MOBILE_MEMORY_SEARCH_LIMIT = 100;

export function buildMemorySearchInput(
  query: string,
): Partial<MemorySearchInputV1> {
  const normalizedQuery = query.trim();
  return {
    ...(normalizedQuery ? { query: normalizedQuery } : {}),
    limit: MOBILE_MEMORY_SEARCH_LIMIT,
  };
}

function countByLabel(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
}

export function buildMemorySearchSummary(items: readonly MemorySeedV1[]) {
  return {
    total: items.length,
    lifecycle: countByLabel(items.map((item) => item.lifecycleState)),
    kinds: countByLabel(items.map((item) => item.kind)),
  };
}

export function sortMemoryConnections(
  connections: readonly MemoryConnectionV1[],
): MemoryConnectionV1[] {
  return [...connections].sort(
    (left, right) =>
      right.edge.score - left.edge.score ||
      left.edge.id.localeCompare(right.edge.id),
  );
}
