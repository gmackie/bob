import {
  ITEM_STATES,
  PLAN_STATES,
  safeHref,
  TERMINAL_PLAN_STATES,
  type EdgeMessage,
  type ItemSnapshot,
  type PlanSnapshot,
  type TopologyRepo,
} from "@bob/sdlc-view";
import type { SqlPort } from "./sql";

/** What the coordinator's edge exporter (packages/bob/coordination/runtime/edge.mjs) POSTs. */
export interface IngestBatch { contractVersion: "1"; kind: "snapshot" | "changes" | "heartbeat"; watermark: number; fromSequence?: number; plans: PlanSnapshot[]; items: ItemSnapshot[] }
export type IngestResult = { accepted: true; watermark: number } | { accepted: false; resync: true };
export type Delta = Extract<EdgeMessage, { type: "delta" }>;
export type Snapshot = Extract<EdgeMessage, { type: "snapshot" }>;
/** Ingest bodies above this are refused (413); the exporter's MAX_BATCH_BYTES matches it. */
export const MAX_INGEST_BYTES = 1_000_000;

// ─── Validation ───────────────────────────────────────────────────────────────

const KINDS = new Set(["snapshot", "changes", "heartbeat"]);
const PLAN_STATE_SET = new Set<string>(PLAN_STATES);
const ITEM_STATE_SET = new Set<string>(ITEM_STATES);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
// What rows() and projectFor() read from a plan's definition of each item.
const isDefinitionItem = (d: unknown) =>
  isRecord(d) && isId(d.itemId) && isRecord(d.issue) && isId(d.issue.issueId) &&
  isRecord(d.target) && isRecord(d.target.repository) && isId(d.target.repository.integrationId) && isId(d.target.repository.repositoryId);
const isPlan = (p: unknown) =>
  isRecord(p) && isId(p.planId) && isSeq(p.resourceVersion) && PLAN_STATE_SET.has(p.state as string) &&
  isRecord(p.definition) && Array.isArray(p.definition.items) && p.definition.items.every(isDefinitionItem) && Array.isArray(p.definition.dependencies);
const isItem = (i: unknown) =>
  isRecord(i) && isId(i.itemId) && isId(i.planId) && isSeq(i.resourceVersion) && ITEM_STATE_SET.has(i.state as string);

/**
 * An issue url is shown as a link, so only http(s) is kept. Any other value is removed
 * from the (freshly parsed) batch rather than refusing it, so the item still shows, as text.
 */
function stripUnsafeIssueUrls(plan: PlanSnapshot) {
  for (const def of plan.definition.items) {
    if ("url" in def.issue && def.issue.url !== null && safeHref(def.issue.url) === null) delete def.issue.url;
  }
}

/** Validates an ingest body. Accepted resources are stored and broadcast, so malformed ones are refused whole. */
export function parseBatch(value: unknown): IngestBatch | null {
  if (!isRecord(value) || value.contractVersion !== "1" || !KINDS.has(value.kind as string)) return null;
  if (!isSeq(value.watermark) || !Array.isArray(value.plans) || !Array.isArray(value.items)) return null;
  if (value.kind === "changes") {
    // Without fromSequence the edge cannot tell whether it missed events.
    if (!isSeq(value.fromSequence) || value.watermark < value.fromSequence) return null;
  } else if (value.fromSequence !== undefined && !isSeq(value.fromSequence)) return null;
  if (value.kind === "heartbeat" && (value.plans.length > 0 || value.items.length > 0)) return null;
  if (!value.plans.every(isPlan) || !value.items.every(isItem)) return null;
  for (const plan of value.plans as PlanSnapshot[]) stripUnsafeIssueUrls(plan);
  return value as unknown as IngestBatch;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export interface EdgeMeta {
  /** Random per storage lifetime; clients resume only within the same epoch. */
  epoch: string;
  /** The coordinator sequence applied through. */
  watermark: number;
  /** The edge's own message sequence (snapshots and deltas). */
  seq: number;
  topology: TopologyRepo[];
  topologyAt: number | null;
  topologyFailedAt: number | null;
}
export interface ApplyOutcome {
  result: IngestResult;
  /** What to log and broadcast once the transaction has committed. */
  message: Delta | Snapshot | null;
  /** The batch was a replay the edge already holds: nothing applied, nothing to send. */
  covered: boolean;
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, rv INTEGER NOT NULL, json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, rv INTEGER NOT NULL, json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS items_by_plan ON items (plan_id)",
  "CREATE TABLE IF NOT EXISTS tombstones (plan_id TEXT PRIMARY KEY, rv INTEGER NOT NULL)",
];
const META_KEYS = { epoch: "epoch", watermark: "watermark", seq: "seq", topology: "topology_json", topologyAt: "topology_at", topologyFailedAt: "topology_failed_at" } as const;

/** Sorted by repoSlug, then startupId, so the same BizPulse list always compares equal. */
export const sortTopology = (topology: TopologyRepo[]) =>
  [...topology].sort((a, b) => (a.repoSlug < b.repoSlug ? -1 : a.repoSlug > b.repoSlug ? 1 : a.startupId < b.startupId ? -1 : a.startupId > b.startupId ? 1 : 0));

/**
 * The edge's state as SQLite rows, one per plan and item, so no single value grows
 * with the plan count. Every change runs in one transaction and returns the message
 * to send; the caller logs and broadcasts it only after the commit.
 *
 * Merge rules (the same as reduce() in @bob/sdlc-view, plus tombstones):
 * - a resource replaces the stored one only with a higher resourceVersion;
 * - a completed or cancelled plan is deleted with all of its items and tombstoned;
 *   later copies of the plan at or below that version, and any item of it, are refused;
 * - a snapshot replaces every plan and item.
 * Deltas carry only what was applied, so a client folding them with reduce() holds
 * exactly these rows.
 */
export class EdgeStore {
  constructor(private readonly sql: SqlPort, newEpoch: () => string = () => crypto.randomUUID()) {
    sql.transaction(() => {
      for (const statement of SCHEMA) sql.exec(statement);
      if (this.read(META_KEYS.epoch) === undefined) {
        this.write(META_KEYS.epoch, newEpoch());
        this.write(META_KEYS.watermark, 0);
        this.write(META_KEYS.seq, 0);
        this.write(META_KEYS.topology, []);
      }
    });
  }

  private read(key: string): unknown {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)[0];
    return row === undefined ? undefined : JSON.parse(row.value);
  }
  private write(key: string, value: unknown) {
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }

  meta(): EdgeMeta {
    const values = new Map(this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM meta").map((r) => [r.key, JSON.parse(r.value) as unknown]));
    return {
      epoch: values.get(META_KEYS.epoch) as string,
      watermark: values.get(META_KEYS.watermark) as number,
      seq: values.get(META_KEYS.seq) as number,
      topology: (values.get(META_KEYS.topology) as TopologyRepo[] | undefined) ?? [],
      topologyAt: (values.get(META_KEYS.topologyAt) as number | undefined) ?? null,
      topologyFailedAt: (values.get(META_KEYS.topologyFailedAt) as number | undefined) ?? null,
    };
  }

  /**
   * - changes starting past the watermark, or a heartbeat ahead of it: resync, nothing written;
   * - changes ending at or below the watermark (a replay): accepted with the batch's own
   *   watermark, which the exporter checks, and nothing applied;
   * - a heartbeat: accepted, nothing written (liveness lives in the caller's memory);
   * - otherwise applied, and a delta is returned when anything changed.
   */
  apply(batch: IngestBatch, now: number): ApplyOutcome {
    return this.sql.transaction(() => {
      const { watermark } = this.meta();
      const accepted: IngestResult = { accepted: true, watermark: batch.watermark };
      if (batch.kind === "heartbeat") {
        return batch.watermark > watermark
          ? { result: { accepted: false, resync: true }, message: null, covered: false }
          : { result: accepted, message: null, covered: false };
      }
      if (batch.kind === "changes") {
        if ((batch.fromSequence ?? Infinity) > watermark) return { result: { accepted: false, resync: true }, message: null, covered: false };
        if (batch.watermark <= watermark) return { result: accepted, message: null, covered: true };
      }
      const snapshot = batch.kind === "snapshot";
      if (snapshot) { this.sql.exec("DELETE FROM plans"); this.sql.exec("DELETE FROM items"); }
      const { plans, items } = this.merge(batch);
      this.write(META_KEYS.watermark, batch.watermark);
      if (snapshot) return { result: accepted, message: this.bump(now), covered: false };
      if (plans.length === 0 && items.length === 0) return { result: accepted, message: null, covered: false };
      const seq = this.nextSeq();
      return { result: accepted, message: { type: "delta", seq, plans, items, coordinatorSeenAt: now }, covered: false };
    });
  }

  /** Writes the batch's resources by the rules above and returns the ones that took effect. */
  private merge(batch: IngestBatch): { plans: PlanSnapshot[]; items: ItemSnapshot[] } {
    const plans: PlanSnapshot[] = [], items: ItemSnapshot[] = [];
    const tombstone = (planId: string) => this.sql.exec<{ rv: number }>("SELECT rv FROM tombstones WHERE plan_id = ?", planId)[0]?.rv;
    for (const p of batch.plans) {
      const dead = tombstone(p.planId);
      if (dead !== undefined && p.resourceVersion <= dead) continue;
      if (TERMINAL_PLAN_STATES.has(p.state)) {
        this.sql.exec("INSERT INTO tombstones (plan_id, rv) VALUES (?, ?) ON CONFLICT (plan_id) DO UPDATE SET rv = excluded.rv", p.planId, p.resourceVersion);
        this.sql.exec("DELETE FROM plans WHERE id = ?", p.planId);
        this.sql.exec("DELETE FROM items WHERE plan_id = ?", p.planId);
        plans.push(p);
        continue;
      }
      if (dead !== undefined) this.sql.exec("DELETE FROM tombstones WHERE plan_id = ?", p.planId); // newer than its end: the coordinator says it lives
      const stored = this.sql.exec<{ rv: number }>("SELECT rv FROM plans WHERE id = ?", p.planId)[0]?.rv;
      if (stored !== undefined && p.resourceVersion <= stored) continue;
      this.sql.exec("INSERT INTO plans (id, rv, json) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET rv = excluded.rv, json = excluded.json", p.planId, p.resourceVersion, JSON.stringify(p));
      plans.push(p);
    }
    for (const i of batch.items) {
      if (tombstone(i.planId) !== undefined) continue;
      const stored = this.sql.exec<{ rv: number }>("SELECT rv FROM items WHERE id = ?", i.itemId)[0]?.rv;
      if (stored !== undefined && i.resourceVersion <= stored) continue;
      this.sql.exec("INSERT INTO items (id, plan_id, rv, json) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET plan_id = excluded.plan_id, rv = excluded.rv, json = excluded.json", i.itemId, i.planId, i.resourceVersion, JSON.stringify(i));
      items.push(i);
    }
    return { plans, items };
  }

  private nextSeq(): number {
    const seq = this.meta().seq + 1;
    this.write(META_KEYS.seq, seq);
    return seq;
  }
  /** Takes the next seq and returns the full state as a snapshot. */
  private bump(coordinatorSeenAt: number | null): Snapshot {
    this.nextSeq();
    return this.snapshot(coordinatorSeenAt);
  }

  /** The full state, as sent to a client that cannot resume from its cursor. */
  snapshot(coordinatorSeenAt: number | null): Snapshot {
    const { epoch, seq, topology } = this.meta();
    const plans = this.sql.exec<{ json: string }>("SELECT json FROM plans ORDER BY id").map((r) => JSON.parse(r.json) as PlanSnapshot);
    const items = this.sql.exec<{ json: string }>("SELECT json FROM items ORDER BY id").map((r) => JSON.parse(r.json) as ItemSnapshot);
    return { type: "snapshot", epoch, seq, plans, items, topology, coordinatorSeenAt };
  }

  /** Stores a BizPulse topology. Returns a snapshot (with the next seq) only when it changed. */
  setTopology(topology: TopologyRepo[], now: number, coordinatorSeenAt: number | null): Snapshot | null {
    const sorted = sortTopology(topology);
    return this.sql.transaction(() => {
      this.write(META_KEYS.topologyAt, now);
      this.write(META_KEYS.topologyFailedAt, null);
      if (JSON.stringify(sorted) === JSON.stringify(this.meta().topology)) return null;
      this.write(META_KEYS.topology, sorted);
      return this.bump(coordinatorSeenAt);
    });
  }

  markTopologyFailed(now: number): void {
    this.write(META_KEYS.topologyFailedAt, now);
  }
}

// ─── Delta log ────────────────────────────────────────────────────────────────

/** In-memory only: after the DO hibernates or restarts, clients simply get a snapshot. */
export class DeltaLog {
  private entries: Delta[] = [];
  constructor(private readonly limit = 200) {}
  push(message: EdgeMessage) {
    if (message.type === "snapshot") this.entries = [];
    else if (message.type === "delta") { this.entries.push(message); if (this.entries.length > this.limit) this.entries.shift(); }
  }
  /** The deltas cursor + 1 .. current, or null unless the log holds every one of them. */
  since(cursor: number, current: number): Delta[] | null {
    if (cursor === current) return [];
    if (cursor > current) return null;
    const out = this.entries.filter((d) => d.seq > cursor);
    if (out.length !== current - cursor) return null;
    return out.every((d, n) => d.seq === cursor + 1 + n) ? out : null;
  }
}
