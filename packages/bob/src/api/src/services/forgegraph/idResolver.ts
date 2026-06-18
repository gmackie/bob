/**
 * ForgeGraph ID Resolver
 *
 * Maps Bob's internal UUIDs to ForgeGraph work-item IDs via the externalId field.
 * Uses an LRU cache to avoid repeated lookups.
 */

import type { ForgeGraphClient } from "./forgeGraphClient";

const MAX_CACHE_SIZE = 500;

/** Maps Bob UUID → ForgeGraph ID */
const cache = new Map<string, string>();

function evictOldest() {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function cacheMapping(bobId: string, fgId: string) {
  evictOldest();
  cache.set(bobId, fgId);
}

export function getCachedFgId(bobId: string): string | undefined {
  const fgId = cache.get(bobId);
  if (fgId) {
    // Move to end (most recently used)
    cache.delete(bobId);
    cache.set(bobId, fgId);
  }
  return fgId;
}

/**
 * Resolve a Bob UUID to a ForgeGraph work-item ID.
 * Returns null if the work item doesn't exist in ForgeGraph.
 */
export async function resolveForgeGraphId(
  client: ForgeGraphClient,
  bobId: string,
): Promise<string | null> {
  const cached = getCachedFgId(bobId);
  if (cached) return cached;

  const item = await client.getWorkItemByExternalId(bobId);
  if (!item) return null;

  cacheMapping(bobId, item.id);
  return item.id;
}

/**
 * Resolve a Bob UUID to a ForgeGraph work-item ID, throwing if not found.
 */
export async function requireForgeGraphId(
  client: ForgeGraphClient,
  bobId: string,
): Promise<string> {
  const fgId = await resolveForgeGraphId(client, bobId);
  if (!fgId) {
    throw new Error(`Work item ${bobId} not found in ForgeGraph`);
  }
  return fgId;
}

/** Clear the cache (for testing). */
export function clearIdCache() {
  cache.clear();
}
