/**
 * A Beat is one real event, rendered exactly once (BOB-91). Lenses never invent motion:
 * everything that moves on an Arcade surface traces back to a Beat or to the current view.
 *
 * Slice 1 produces beats from the SDLC edge only (sdlc-beats.ts). Session, ForgeGraph and
 * budget beats join through the same envelope once the gateway forwards their payloads.
 */
export type BeatSource = "session" | "sdlc" | "kanbanger" | "forgegraph" | "budget";

export type BeatKind =
  /** An item appeared on the floor (a plan started or was extended). */
  | "item.entered"
  /** An item moved forward along a coordinator transition. */
  | "item.advanced"
  /** An item took a back edge (STATE_EDGES loop): repair, re-check, retry, pause. */
  | "item.looped"
  /** An item now needs a human: waiting for input, review, or a blocked release. */
  | "item.needs_human"
  /** An item failed (or its release's checks failed). */
  | "item.failed"
  /** An item left the floor (its plan completed or was cancelled). */
  | "item.left"
  /** The item's release moved stage (BOB-82): checks, review-ready, merged, deploying… */
  | "release.stage"
  /** The item achieved a milestone (execution-succeeded … production-verified). */
  | "milestone"
  /** The source skipped events; the view is incomplete until it resyncs. Shown as static. */
  | "gap";

export interface BeatSubject {
  itemId?: string;
  planId?: string;
  /** The tracker identifier, e.g. "BOB-91". */
  issue?: string;
  pr?: number;
  sha?: string;
  deploymentId?: string;
}

export interface Beat {
  /** Stable and unique: the dedupe key. */
  id: string;
  source: BeatSource;
  /** The source's ordering domain (the SDLC edge's epoch). */
  epoch: string;
  /** Order within the epoch (the edge seq that produced the beat). */
  seq: number;
  /** Epoch milliseconds the beat was observed. */
  at: number;
  kind: BeatKind;
  subject: BeatSubject;
  data?: Record<string, string | number | boolean | null>;
}
