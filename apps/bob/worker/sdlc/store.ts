import {
  emptyView,
  ITEM_STATES,
  PLAN_STATES,
  reduce,
  type EdgeMessage,
  type EdgeView,
  type ItemSnapshot,
  type PlanSnapshot,
} from "@bob/sdlc-view";

/** What the coordinator's edge exporter (packages/bob/coordination/runtime/edge.mjs) POSTs. */
export interface IngestBatch { contractVersion: "1"; kind: "snapshot" | "changes" | "heartbeat"; watermark: number; fromSequence?: number; plans: PlanSnapshot[]; items: ItemSnapshot[] }
/** watermark: the coordinator sequence the edge has applied through. view.seq is the edge's own message sequence. */
export interface EdgeState { watermark: number; view: EdgeView; topologyAt?: number }
export type IngestResult = { accepted: true; watermark: number } | { accepted: false; resync: true };
type Delta = Extract<EdgeMessage, { type: "delta" }>;

export const emptyEdge = (): EdgeState => ({ watermark: 0, view: emptyView() });

const KINDS = new Set(["snapshot", "changes", "heartbeat"]);
const PLAN_STATE_SET = new Set<string>(PLAN_STATES);
const ITEM_STATE_SET = new Set<string>(ITEM_STATES);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
// Only what the reducer and rows() index into; anything else passes through untouched.
const isPlan = (p: unknown) =>
  isRecord(p) && isId(p.planId) && isSeq(p.resourceVersion) && PLAN_STATE_SET.has(p.state as string) &&
  isRecord(p.definition) && Array.isArray(p.definition.items) && Array.isArray(p.definition.dependencies);
const isItem = (i: unknown) =>
  isRecord(i) && isId(i.itemId) && isId(i.planId) && isSeq(i.resourceVersion) && ITEM_STATE_SET.has(i.state as string);

/** Validates an ingest body. Accepted state is persisted and broadcast, so malformed resources are refused whole. */
export function parseBatch(value: unknown): IngestBatch | null {
  if (!isRecord(value) || value.contractVersion !== "1" || !KINDS.has(value.kind as string)) return null;
  if (!isSeq(value.watermark) || !Array.isArray(value.plans) || !Array.isArray(value.items)) return null;
  if (value.kind === "changes") {
    // Without fromSequence the edge cannot tell whether it missed events.
    if (!isSeq(value.fromSequence) || value.watermark < value.fromSequence) return null;
  } else if (value.fromSequence !== undefined && !isSeq(value.fromSequence)) return null;
  if (!value.plans.every(isPlan) || !value.items.every(isItem)) return null;
  return value as unknown as IngestBatch;
}

/**
 * Folds one exporter batch into the edge state. Merging is reduce()'s job.
 * - changes that start past the edge's watermark, or a heartbeat ahead of it, mean the
 *   edge missed events: it refuses and asks for a snapshot (the exporter resets its checkpoint).
 * - changes that overlap (a retry after a lost response) are applied; resourceVersion keeps
 *   the newest, and the watermark never moves back. The reply echoes the batch's watermark,
 *   which is what the exporter checks.
 * - an empty changes batch (every resource out of policy) is accepted and advances the
 *   watermark, but only produces a status message: it does not use up a delta seq.
 */
export function applyBatch(state: EdgeState, batch: IngestBatch, now: number): { state: EdgeState; result: IngestResult; message: EdgeMessage | null } {
  const behind = batch.kind === "changes" ? (batch.fromSequence ?? Infinity) > state.watermark
    : batch.kind === "heartbeat" ? batch.watermark > state.watermark : false;
  if (behind) return { state, result: { accepted: false, resync: true }, message: null };
  const result: IngestResult = { accepted: true, watermark: batch.watermark };
  const watermark = batch.kind === "snapshot" ? batch.watermark : Math.max(state.watermark, batch.watermark);
  const empty = batch.plans.length === 0 && batch.items.length === 0;
  if (batch.kind === "heartbeat" || (batch.kind === "changes" && empty)) {
    const message: EdgeMessage = { type: "status", coordinatorSeenAt: now };
    return { state: { ...state, watermark, view: reduce(state.view, message) }, result, message };
  }
  const seq = state.view.seq + 1;
  const message: EdgeMessage = batch.kind === "snapshot"
    ? { type: "snapshot", seq, plans: batch.plans, items: batch.items, topology: state.view.topology, coordinatorSeenAt: now }
    : { type: "delta", seq, plans: batch.plans, items: batch.items, coordinatorSeenAt: now };
  return { state: { ...state, watermark, view: reduce(state.view, message) }, result, message };
}

/** In-memory only: after the DO hibernates or restarts, clients simply get a snapshot. */
export class DeltaLog {
  private entries: Delta[] = [];
  constructor(private readonly limit = 200) {}
  push(message: EdgeMessage) {
    if (message.type === "snapshot") this.entries = [];
    else if (message.type === "delta") { this.entries.push(message); if (this.entries.length > this.limit) this.entries.shift(); }
  }
  /** The deltas after cursor through current, or null when the log cannot cover that range. */
  since(cursor: number, current: number): Delta[] | null {
    if (cursor === current) return [];
    const first = this.entries[0];
    if (!first || cursor < first.seq - 1 || cursor > current) return null;
    return this.entries.filter((d) => d.seq > cursor);
  }
}

export function snapshotOf(state: EdgeState): EdgeMessage {
  const { view } = state;
  return { type: "snapshot", seq: view.seq, plans: Object.values(view.plans), items: Object.values(view.items), topology: view.topology, coordinatorSeenAt: view.coordinatorSeenAt };
}

export function helloReply(state: EdgeState, log: DeltaLog, cursor: number | null): EdgeMessage[] {
  const deltas = cursor === null ? null : log.since(cursor, state.view.seq);
  return deltas ?? [snapshotOf(state)];
}
