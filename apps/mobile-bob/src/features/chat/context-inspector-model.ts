import type {
  ContextPackV1,
  ContextSourceTypeV1,
} from "@gmacko/ooda-client/v1";

export function findLatestContextPackId(
  items: readonly { contextPackId?: string }[],
): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const contextPackId = items[index]?.contextPackId;
    if (contextPackId) return contextPackId;
  }
  return undefined;
}

export function buildContextInspectorSummary(pack: ContextPackV1) {
  const sourceCounts = new Map<ContextSourceTypeV1, number>();
  let disclosed = 0;

  for (const item of pack.items) {
    if (item.decision === "disclosed") disclosed += 1;
    sourceCounts.set(
      item.sourceType,
      (sourceCounts.get(item.sourceType) ?? 0) + 1,
    );
  }

  return {
    total: pack.items.length,
    disclosed,
    withheld: pack.items.length - disclosed,
    sources: [...sourceCounts.entries()]
      .map(([sourceType, count]) => ({ sourceType, count }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.sourceType.localeCompare(right.sourceType),
      ),
  };
}
