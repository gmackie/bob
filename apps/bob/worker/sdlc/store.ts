import {
  ITEM_STATES,
  parseCommandResult,
  PLAN_STATES,
  safeHref,
  TERMINAL_PLAN_STATES,
  type CommandResult,
  type EdgeMessage,
  type IssueBatch,
  type TrackedIssue,
  type ItemSnapshot,
  type PlanSnapshot,
  type QueuedCommand,
  type ShippedEntry,
  type TopologyRepo,
} from "@bob/sdlc-view";
import { ALERT_SCHEMA, AlertLedger, type ItemAlert } from "./alerts";
import { migrateOutbox, OUTBOX_SCHEMA } from "./outbox";
import { LIVE_ACTIVITY_SCHEMA, migrateLiveActivities } from "./live-activity";
import { SHIPPED_SCHEMA, ShippedLedger } from "./shipped";
import type { SqlPort } from "./sql";

/** What the coordinator's edge exporter (packages/bob/coordination/runtime/edge.mjs) POSTs. */
export interface IngestBatch {
  contractVersion: "1"; kind: "snapshot" | "changes" | "heartbeat"; watermark: number; fromSequence?: number; plans: PlanSnapshot[]; items: ItemSnapshot[];
  /** The outcomes of commands from earlier responses (BOB-79). Any kind of batch may carry them. */
  results?: CommandResult[];
}
/** What applying the batch's state did. */
export type ApplyResult = { accepted: true; watermark: number } | { accepted: false; resync: true };
/**
 * The ingest response. commands: queued commands for the exporter to run (also on a resync).
 * pollMs: present while commands are queued, or within ACTIVE_POLL_WINDOW_MS of a result; the exporter polls that often.
 */
export type IngestResult = ApplyResult & { commands: QueuedCommand[]; pollMs?: number };
/** More results than this in one batch is refused. */
export const MAX_RESULTS_PER_BATCH = 500;
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
  let results: CommandResult[] | undefined;
  if (value.results !== undefined) {
    if (!Array.isArray(value.results) || value.results.length > MAX_RESULTS_PER_BATCH) return null;
    results = [];
    for (const raw of value.results) {
      const result = parseCommandResult(raw);
      if (!result) return null;
      results.push(result);
    }
    value.results = results;
  }
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
  result: ApplyResult;
  /** What to log and broadcast once the transaction has committed. */
  message: Delta | Snapshot | null;
  /** The batch was a replay the edge already holds: nothing applied, nothing to send. */
  covered: boolean;
  /** Items that newly entered waiting-input, review or failed (alerts.ts); recorded in the same transaction. */
  alerts: ItemAlert[];
  /** Items that first reached production-verified in this batch (BOB-95); recorded in the same transaction. */
  shipped: ShippedEntry[];
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, rv INTEGER NOT NULL, json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, rv INTEGER NOT NULL, json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS items_by_plan ON items (plan_id)",
  "CREATE TABLE IF NOT EXISTS tombstones (plan_id TEXT PRIMARY KEY, rv INTEGER NOT NULL)",
  // BOB-99: mirrored Kanbanger issues, newest version per issue.
  "CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, version INTEGER NOT NULL, json TEXT NOT NULL)",
  ...OUTBOX_SCHEMA,
  ...ALERT_SCHEMA,
  ...SHIPPED_SCHEMA,
  ...LIVE_ACTIVITY_SCHEMA,
];
const META_KEYS = { epoch: "epoch", watermark: "watermark", seq: "seq", topology: "topology_json", topologyAt: "topology_at", topologyFailedAt: "topology_failed_at", coordinatorSeenAt: "coordinator_seen_at" } as const;

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
  readonly alerts: AlertLedger;
  readonly shipped: ShippedLedger;

  constructor(private readonly sql: SqlPort, newEpoch: () => string = () => crypto.randomUUID()) {
    this.alerts = new AlertLedger(sql);
    this.shipped = new ShippedLedger(sql);
    sql.transaction(() => {
      for (const statement of SCHEMA) sql.exec(statement);
      migrateOutbox(sql);
      migrateLiveActivities(sql);
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

  /** When the coordinator was last heard from, as last persisted; null when never. */
  coordinatorSeenAt(): number | null {
    const value = this.read(META_KEYS.coordinatorSeenAt);
    return typeof value === "number" ? value : null;
  }
  setCoordinatorSeenAt(at: number): void {
    this.write(META_KEYS.coordinatorSeenAt, at);
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
   * - a heartbeat: accepted, nothing written here (the caller persists liveness, throttled);
   * - otherwise applied, and a delta is returned when anything changed.
   */
  apply(batch: IngestBatch, now: number): ApplyOutcome {
    return this.sql.transaction(() => {
      const { watermark } = this.meta();
      const accepted: ApplyResult = { accepted: true, watermark: batch.watermark };
      if (batch.kind === "heartbeat") {
        return batch.watermark > watermark
          ? { result: { accepted: false, resync: true }, message: null, covered: false, alerts: [], shipped: [] }
          : { result: accepted, message: null, covered: false, alerts: [], shipped: [] };
      }
      if (batch.kind === "changes") {
        if ((batch.fromSequence ?? Infinity) > watermark) return { result: { accepted: false, resync: true }, message: null, covered: false, alerts: [], shipped: [] };
        if (batch.watermark <= watermark) return { result: accepted, message: null, covered: true, alerts: [], shipped: [] };
      }
      const snapshot = batch.kind === "snapshot";
      // What the batch's items were before it, for alerts: a snapshot replaces items the edge already held.
      const previous = new Map<string, ItemSnapshot>();
      for (const i of batch.items) { const held = this.item(i.itemId); if (held) previous.set(i.itemId, held); }
      // A fresh edge's first snapshot records what is already waiting without alerting on it.
      const baseline = snapshot && watermark === 0 && (this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM items")[0]?.n ?? 0) === 0;
      if (snapshot) { this.sql.exec("DELETE FROM plans"); this.sql.exec("DELETE FROM items"); }
      const { plans, items } = this.merge(batch, previous, snapshot, now);
      const alerts = this.alerts.observe(items, previous, baseline, now);
      const shipped = this.shipped.observe(items, previous, baseline, (id) => this.plan(id), now);
      if (snapshot || plans.some((p) => TERMINAL_PLAN_STATES.has(p.state))) this.alerts.prune();
      this.write(META_KEYS.watermark, batch.watermark);
      if (snapshot) return { result: accepted, message: this.bump(now), covered: false, alerts, shipped };
      if (plans.length === 0 && items.length === 0) return { result: accepted, message: null, covered: false, alerts, shipped };
      const seq = this.nextSeq();
      return { result: accepted, message: { type: "delta", seq, plans, items, coordinatorSeenAt: now }, covered: false, alerts, shipped };
    });
  }

  /**
   * Writes the batch's resources by the rules above and returns the ones that took effect.
   * Each written item carries stateSince (BOB-101): kept while its state is unchanged, now
   * when the state changes, and null when a snapshot brings an item the edge never held
   * (it cannot know how long that item has been in its state).
   */
  private merge(batch: IngestBatch, previous: Map<string, ItemSnapshot>, snapshot: boolean, now: number): { plans: PlanSnapshot[]; items: ItemSnapshot[] } {
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
      const held = previous.get(i.itemId);
      const stateSince = held ? (held.state === i.state ? (held.stateSince ?? null) : now) : snapshot ? null : now;
      const stamped: ItemSnapshot = { ...i, stateSince };
      this.sql.exec("INSERT INTO items (id, plan_id, rv, json) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET plan_id = excluded.plan_id, rv = excluded.rv, json = excluded.json", i.itemId, i.planId, i.resourceVersion, JSON.stringify(stamped));
      items.push(stamped);
    }
    return { plans, items };
  }

  /**
   * BOB-99: applies a mirrored issue batch in one transaction. An upsert replaces a stored
   * issue only when its version is higher. `complete` removes every stored issue it does not
   * list. Returns the delta to broadcast (null when nothing changed) and the counts.
   */
  applyIssues(batch: IssueBatch, coordinatorSeenAt: number): { message: Delta | null; stored: number; removed: number } {
    return this.sql.transaction(() => {
      const changed: TrackedIssue[] = [];
      for (const issue of batch.upserts) {
        const held = this.sql.exec<{ version: number }>("SELECT version FROM issues WHERE id = ?", issue.id)[0]?.version;
        if (held !== undefined && issue.version <= held) continue;
        this.sql.exec("INSERT INTO issues (id, version, json) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version, json = excluded.json", issue.id, issue.version, JSON.stringify(issue));
        changed.push(issue);
      }
      const removed: string[] = [];
      if (batch.complete) {
        const keep = new Set(batch.complete.ids);
        // An issue upserted in this same batch is present even if a caller forgot to list it.
        for (const issue of batch.upserts) keep.add(issue.id);
        for (const { id } of this.sql.exec<{ id: string }>("SELECT id FROM issues")) {
          if (keep.has(id)) continue;
          this.sql.exec("DELETE FROM issues WHERE id = ?", id);
          removed.push(id);
        }
      }
      if (changed.length === 0 && removed.length === 0) return { message: null, stored: 0, removed: 0 };
      const seq = this.nextSeq();
      const message: Delta = { type: "delta", seq, plans: [], items: [], coordinatorSeenAt, ...(changed.length ? { issues: changed } : {}), ...(removed.length ? { issuesRemoved: removed } : {}) };
      return { message, stored: changed.length, removed: removed.length };
    });
  }

  issueCount(): number {
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM issues")[0]?.n ?? 0;
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

  plan(planId: string): PlanSnapshot | undefined {
    const row = this.sql.exec<{ json: string }>("SELECT json FROM plans WHERE id = ?", planId)[0];
    return row ? (JSON.parse(row.json) as PlanSnapshot) : undefined;
  }
  item(itemId: string): ItemSnapshot | undefined {
    const row = this.sql.exec<{ json: string }>("SELECT json FROM items WHERE id = ?", itemId)[0];
    return row ? (JSON.parse(row.json) as ItemSnapshot) : undefined;
  }

  /** The full state, as sent to a client that cannot resume from its cursor. */
  snapshot(coordinatorSeenAt: number | null): Snapshot {
    const { epoch, seq, topology } = this.meta();
    const plans = this.sql.exec<{ json: string }>("SELECT json FROM plans ORDER BY id").map((r) => JSON.parse(r.json) as PlanSnapshot);
    const items = this.sql.exec<{ json: string }>("SELECT json FROM items ORDER BY id").map((r) => JSON.parse(r.json) as ItemSnapshot);
    const issues = this.sql.exec<{ json: string }>("SELECT json FROM issues ORDER BY id").map((r) => JSON.parse(r.json) as TrackedIssue);
    return { type: "snapshot", epoch, seq, plans, items, topology, coordinatorSeenAt, issues };
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
