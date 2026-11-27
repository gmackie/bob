import type { Beat } from "./beat";

/** The time this surface received a beat is independent of the source clock. */
export interface RecordedBeat extends Beat {
  receivedAt: number;
}

/**
 * A bounded, deduplicated log of beats, shared by every lens on a surface. Platform
 * agnostic: React (web or native) reads it through useSyncExternalStore.
 */
export interface BeatLog {
  /** Appends beats not seen before; returns the ones that were new, in order. */
  push(beats: readonly Beat[], receivedAt?: number): Beat[];
  /** The newest beats, newest first. */
  recent(limit?: number): readonly RecordedBeat[];
  /** Bumps on every push that added a beat. */
  version(): number;
  subscribe(listener: () => void): () => void;
}

export function createBeatLog(capacity = 200): BeatLog {
  let beats: RecordedBeat[] = [];
  const seen = new Set<string>();
  const order: string[] = [];
  let ver = 0;
  const listeners = new Set<() => void>();
  // Ids are remembered longer than beats are kept, so a late replay is still dropped.
  const seenCap = capacity * 5;

  return {
    push(incoming, receivedAt = Date.now()) {
      const fresh = incoming.filter((b) => !seen.has(b.id) && (seen.add(b.id), order.push(b.id), true));
      if (!fresh.length) return [];
      while (order.length > seenCap) seen.delete(order.shift()!);
      const recorded = fresh.map((beat) => ({ ...beat, receivedAt }));
      beats = [...recorded.reverse(), ...beats].slice(0, capacity);
      ver++;
      for (const l of listeners) l();
      return fresh;
    },
    recent: (limit = capacity) => beats.slice(0, limit),
    version: () => ver,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
