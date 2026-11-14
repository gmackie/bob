import { describe, expect, it } from "vitest";
import { emptyView, reduce, type EdgeMessage, type EdgeView, type ItemSnapshot, type PlanSnapshot } from "@bob/sdlc-view";
import { DeltaLog, EdgeStore, MAX_INGEST_BYTES, parseBatch, type IngestBatch } from "./store";
import { durableObjectSql } from "./sql";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

const target = { environmentId: "hetzner-bob", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const issue = { integrationId: "kanbanger", workspaceId: "gmacko", teamId: "GMA", projectId: "bob", issueId: "i" };
const item = (itemId: string, resourceVersion: number, state: ItemSnapshot["state"] = "ready", planId = "p"): ItemSnapshot =>
  ({ itemId, planId, resourceVersion, state, currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] });
const plan = (planId: string, resourceVersion: number, state: PlanSnapshot["state"] = "active", ids: string[] = []): PlanSnapshot =>
  ({ planId, resourceVersion, state, definition: { items: ids.map((itemId) => ({ itemId, issue, target, completionTarget: "production" })), dependencies: [], concurrencyLimit: 1 } });
const batch = (b: Partial<IngestBatch>): IngestBatch => ({ contractVersion: "1", kind: "changes", watermark: 0, plans: [], items: [], ...b });
const store = (sql = nodeSqlitePort()) => new EdgeStore(sql, () => "epoch-1");
const WRITES = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;

describe("EdgeStore.apply", () => {
  it("accepts a snapshot, sets the watermark and sends a snapshot carrying the epoch", () => {
    const s = store();
    const { result, message } = s.apply(batch({ kind: "snapshot", watermark: 4, plans: [plan("p", 1)], items: [item("a", 1)] }), 100);
    expect(result).toEqual({ accepted: true, watermark: 4 });
    expect(s.meta()).toMatchObject({ watermark: 4, seq: 1, epoch: "epoch-1" });
    expect(message).toMatchObject({ type: "snapshot", epoch: "epoch-1", seq: 1, coordinatorSeenAt: 100, plans: [{ planId: "p" }], items: [{ itemId: "a" }] });
  });
  it("asks for a resync when changes start past its watermark, or a heartbeat is ahead of it", () => {
    const s = store();
    s.apply(batch({ kind: "snapshot", watermark: 4 }), 100);
    expect(s.apply(batch({ fromSequence: 9, watermark: 12 }), 200)).toMatchObject({ result: { accepted: false, resync: true }, message: null });
    expect(s.apply(batch({ kind: "heartbeat", watermark: 9 }), 200)).toMatchObject({ result: { accepted: false, resync: true }, message: null });
    expect(s.meta()).toMatchObject({ watermark: 4, seq: 1 });
  });
  it("applies contiguous changes as the next delta", () => {
    const s = store();
    s.apply(batch({ kind: "snapshot", watermark: 4, items: [item("a", 1)] }), 100);
    const next = s.apply(batch({ fromSequence: 4, watermark: 6, items: [item("a", 2, "running")] }), 200);
    expect(next.result).toEqual({ accepted: true, watermark: 6 });
    expect(next.message).toEqual({ type: "delta", seq: 2, plans: [], items: [item("a", 2, "running")], coordinatorSeenAt: 200 });
    expect(s.snapshot(null).items).toEqual([item("a", 2, "running")]);
  });
  it("accepts an empty changes batch (every resource out of policy) and advances the watermark without a delta", () => {
    const s = store();
    s.apply(batch({ kind: "snapshot", watermark: 4 }), 100);
    const next = s.apply(batch({ fromSequence: 4, watermark: 7 }), 200);
    expect(next).toEqual({ result: { accepted: true, watermark: 7 }, message: null, covered: false });
    expect(s.meta()).toMatchObject({ watermark: 7, seq: 1 });
  });
  it("answers a covered replay with that batch's watermark and applies nothing", () => {
    const sql = nodeSqlitePort(), s = store(sql);
    s.apply(batch({ kind: "snapshot", watermark: 4, items: [item("a", 1)] }), 100);
    s.apply(batch({ fromSequence: 4, watermark: 6, items: [item("a", 3, "running")] }), 200);
    const writes = sql.statements.length;
    const replay = s.apply(batch({ fromSequence: 4, watermark: 5, items: [item("a", 2, "reserved"), item("b", 1)] }), 300);
    expect(replay).toEqual({ result: { accepted: true, watermark: 5 }, message: null, covered: true }); // the exporter checks result.watermark === batch.watermark
    expect(sql.statements.slice(writes).filter((q) => WRITES.test(q))).toEqual([]);
    expect(s.meta()).toMatchObject({ watermark: 6, seq: 2 });
    expect(s.snapshot(null).items).toEqual([item("a", 3, "running")]);
  });
  it("keeps the newest resourceVersion in an overlapping batch and leaves stale rows out of the delta", () => {
    const s = store();
    s.apply(batch({ kind: "snapshot", watermark: 4, items: [item("a", 3, "running")] }), 100);
    const next = s.apply(batch({ fromSequence: 3, watermark: 6, items: [item("a", 2, "reserved"), item("b", 1)] }), 200);
    expect(next.message).toMatchObject({ type: "delta", items: [{ itemId: "b" }] });
    expect(s.snapshot(null).items.map((i) => [i.itemId, i.state])).toEqual([["a", "running"], ["b", "ready"]]);
  });
  it("evicts a terminal plan with its items and refuses late copies of either", () => {
    const s = store();
    s.apply(batch({ kind: "snapshot", watermark: 1, plans: [plan("p", 1), plan("q", 1)], items: [item("a", 1), item("c", 1, "ready", "q")] }), 1);
    const done = s.apply(batch({ fromSequence: 1, watermark: 2, plans: [plan("p", 2, "completed")], items: [item("b", 1)] }), 2);
    expect(done.message).toMatchObject({ type: "delta", plans: [{ planId: "p", state: "completed" }], items: [] });
    expect(s.snapshot(null)).toMatchObject({ plans: [{ planId: "q" }], items: [{ itemId: "c" }] });
    // A late GetItem of the finished plan's item, and an old copy of the plan, must not bring it back.
    const late = s.apply(batch({ fromSequence: 2, watermark: 3, plans: [plan("p", 1)], items: [item("a", 2, "completed")] }), 3);
    expect(late.message).toBeNull();
    expect(s.snapshot(null)).toMatchObject({ plans: [{ planId: "q" }], items: [{ itemId: "c" }] });
  });
  it("heartbeats write nothing", () => {
    const sql = nodeSqlitePort(), s = store(sql);
    s.apply(batch({ kind: "snapshot", watermark: 3 }), 1);
    const writes = sql.statements.length;
    expect(s.apply(batch({ kind: "heartbeat", watermark: 3 }), 2)).toEqual({ result: { accepted: true, watermark: 3 }, message: null, covered: false });
    expect(sql.statements.slice(writes).filter((q) => WRITES.test(q))).toEqual([]);
  });
  it("rolls back every write when storage fails part way through", () => {
    const sql = nodeSqlitePort(), s = store(sql);
    s.apply(batch({ kind: "snapshot", watermark: 1, plans: [plan("p", 1)], items: [item("a", 1)] }), 1);
    const before = { meta: s.meta(), snap: s.snapshot(null) };
    sql.failNext(/INTO items/);
    expect(() => s.apply(batch({ fromSequence: 1, watermark: 2, plans: [plan("p", 2)], items: [item("a", 2, "running")] }), 2)).toThrow(/injected/);
    expect({ meta: s.meta(), snap: s.snapshot(null) }).toEqual(before);
  });
  it("keeps each plan and item in its own row and survives a restart", () => {
    const sql = nodeSqlitePort();
    const many = Array.from({ length: 300 }, (_, n) => item(`i${n}`, 1));
    store(sql).apply(batch({ kind: "snapshot", watermark: 9, plans: [plan("p", 1)], items: many }), 1);
    expect(sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM items")[0]?.n).toBe(300);
    const again = new EdgeStore(sql, () => "never-used");
    expect(again.meta()).toMatchObject({ epoch: "epoch-1", watermark: 9, seq: 1 });
    expect(again.snapshot(null).items).toHaveLength(300);
  });
  it("creates a random epoch once", () => {
    const sql = nodeSqlitePort();
    const first = new EdgeStore(sql).meta().epoch;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(new EdgeStore(sql).meta().epoch).toBe(first);
    expect(new EdgeStore(nodeSqlitePort()).meta().epoch).not.toBe(first);
  });
});

describe("EdgeStore topology", () => {
  const bob = { startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" };
  const pulse = { startupId: "s2", startupName: "Pulse", repoSlug: "gmackie/pulse" };
  it("stores a sorted topology, and sends a snapshot with the next seq only when it changed", () => {
    const s = store();
    s.apply(batch({ kind: "snapshot", watermark: 1 }), 1);
    const changed = s.setTopology([pulse, bob], 10, 5);
    expect(changed).toMatchObject({ type: "snapshot", seq: 2, topology: [bob, pulse], coordinatorSeenAt: 5 });
    expect(s.setTopology([bob, pulse], 20, 5)).toBeNull();
    expect(s.setTopology([pulse, bob], 30, 5)).toBeNull();
    expect(s.meta()).toMatchObject({ seq: 2, topologyAt: 30, topology: [bob, pulse] });
  });
  it("keeps the topology across a coordinator snapshot", () => {
    const s = store();
    s.setTopology([bob], 1, null);
    expect(s.apply(batch({ kind: "snapshot", watermark: 1 }), 1).message).toMatchObject({ topology: [bob] });
  });
  it("records a failed refresh and clears it on the next success", () => {
    const s = store();
    s.markTopologyFailed(50);
    expect(s.meta().topologyFailedAt).toBe(50);
    s.setTopology([bob], 60, null);
    expect(s.meta()).toMatchObject({ topologyFailedAt: null, topologyAt: 60 });
  });
});

describe("EdgeStore matches reduce", () => {
  // A deterministic stream of coordinator batches: plans and items move forward, some
  // copies arrive stale, plans finish, and a snapshot comes now and then.
  function stream(seed: number, hostile: boolean) {
    let x = seed;
    const rand = () => { x = (x * 1103515245 + 12345) % 2 ** 31; return x / 2 ** 31; };
    const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
    const live = new Map<string, { rv: number; items: Map<string, number> }>();
    const gone: Array<{ planId: string; itemId: string }> = [];
    const sent: IngestBatch[] = [];
    let w = 0, n = 0;
    const out: IngestBatch[] = [];
    const states: ItemSnapshot["state"][] = ["pending", "ready", "running", "review", "completed"];
    for (let step = 0; step < 60; step++) {
      if (live.size < 3) { const id = `p${n++}`; live.set(id, { rv: 1, items: new Map([[`${id}-a`, 1], [`${id}-b`, 1]]) }); }
      if (step === 0 || rand() < 0.1) {
        const plans = [...live].map(([id, p]) => plan(id, p.rv, "active", [...p.items.keys()]));
        const items = [...live].flatMap(([id, p]) => [...p.items].map(([itemId, rv]) => item(itemId, rv, pick(states), id)));
        out.push(batch({ kind: "snapshot", watermark: w, plans, items }));
        continue;
      }
      if (hostile && sent.length && rand() < 0.15) { out.push(pick(sent)); continue; } // covered replay
      const plans: PlanSnapshot[] = [], items: ItemSnapshot[] = [];
      for (const [id, p] of live) {
        if (rand() < 0.4) continue;
        for (const [itemId, rv] of p.items) {
          if (rand() < 0.5) { p.items.set(itemId, rv + 1); items.push(item(itemId, rv + 1, pick(states), id)); }
          else if (rand() < 0.3) items.push(item(itemId, Math.max(1, rv - 1), "pending", id)); // stale copy
        }
        if (rand() < 0.2) {
          p.rv++;
          plans.push(plan(id, p.rv, pick(["completed", "cancelled"] as const), [...p.items.keys()]));
          live.delete(id);
          gone.push({ planId: id, itemId: [...p.items.keys()][0]! });
        } else if (rand() < 0.3) { p.rv++; plans.push(plan(id, p.rv, "active", [...p.items.keys()])); }
      }
      if (hostile && gone.length && rand() < 0.3) {
        const g = pick(gone);
        items.push(item(g.itemId, 99, "completed", g.planId)); // late GetItem of a finished plan's item
        plans.push(plan(g.planId, 1, "active"));                // and an old copy of the plan
      }
      const next = batch({ fromSequence: w, watermark: w + 1 + Math.floor(rand() * 3), plans, items });
      w = next.watermark; sent.push(next); out.push(next);
    }
    return out;
  }
  const pick = (v: { plans: Record<string, PlanSnapshot> | PlanSnapshot[]; items: Record<string, ItemSnapshot> | ItemSnapshot[] }) => {
    const byId = <T,>(list: T[] | Record<string, T>, id: (t: T) => string) =>
      Object.fromEntries((Array.isArray(list) ? list.map((t) => [id(t), t] as const) : Object.entries(list)).sort(([a], [b]) => a.localeCompare(b)));
    return { plans: byId(v.plans, (p) => p.planId), items: byId(v.items, (i) => i.itemId) };
  };

  for (const seed of [1, 7, 42, 1234]) {
    it(`applies the coordinator's batches as reduce would (seed ${seed})`, () => {
      const s = store();
      let view = emptyView(), seq = 0;
      for (const b of stream(seed, false)) {
        s.apply(b, 1);
        seq++;
        const message: EdgeMessage = b.kind === "snapshot"
          ? { type: "snapshot", epoch: "x", seq, plans: b.plans, items: b.items, topology: [], coordinatorSeenAt: 1 }
          : { type: "delta", seq, plans: b.plans, items: b.items, coordinatorSeenAt: 1 };
        view = reduce(view, message);
      }
      expect(pick(s.snapshot(null))).toEqual(pick(view));
    });
    it(`keeps a client folding its messages identical to its rows, replays and late copies included (seed ${seed})`, () => {
      const s = store();
      let client: EdgeView = reduce(emptyView(), s.snapshot(null));
      for (const b of stream(seed, true)) {
        const { message } = s.apply(b, 1);
        if (message) client = reduce(client, message);
      }
      const truth = s.snapshot(null);
      expect(pick(client)).toEqual(pick(truth));
      expect(client).toMatchObject({ epoch: truth.epoch, seq: truth.seq, needsResync: false });
    });
  }
});

describe("parseBatch", () => {
  it("rejects anything that isn't a contract-version-1 batch", () => {
    expect(parseBatch(null)).toBeNull();
    expect(parseBatch({ contractVersion: "2", kind: "changes", watermark: 1, plans: [], items: [] })).toBeNull();
    expect(parseBatch({ contractVersion: "1", kind: "nope", watermark: 1, plans: [], items: [] })).toBeNull();
    expect(parseBatch({ contractVersion: "1", kind: "changes", watermark: -1, plans: [], items: [] })).toBeNull();
    expect(parseBatch({ contractVersion: "1", kind: "heartbeat", watermark: 3, plans: [], items: [] })).not.toBeNull();
  });
  it("requires changes to say where they start, and not to end before that", () => {
    expect(parseBatch({ contractVersion: "1", kind: "changes", watermark: 3, plans: [], items: [] })).toBeNull();
    expect(parseBatch({ contractVersion: "1", kind: "changes", fromSequence: 4, watermark: 3, plans: [], items: [] })).toBeNull();
    expect(parseBatch({ contractVersion: "1", kind: "changes", fromSequence: 2, watermark: 3, plans: [], items: [] })).not.toBeNull();
  });
  it("rejects a heartbeat that carries resources", () => {
    expect(parseBatch({ contractVersion: "1", kind: "heartbeat", watermark: 3, plans: [plan("p", 1)], items: [] })).toBeNull();
    expect(parseBatch({ contractVersion: "1", kind: "heartbeat", watermark: 3, plans: [], items: [item("a", 1)] })).toBeNull();
  });
  it("rejects plans and items the view could not index", () => {
    const ok = { contractVersion: "1", kind: "snapshot", watermark: 1 };
    expect(parseBatch({ ...ok, plans: [plan("p", 1, "active", ["a"])], items: [item("a", 1)] })).not.toBeNull();
    expect(parseBatch({ ...ok, plans: [{ planId: "p", resourceVersion: 1, state: "active" }], items: [] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [{ ...plan("p", 1), state: "gone" }], items: [] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [{ ...item("a", 1), planId: 3 }] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [{ ...item("a", 1), resourceVersion: "1" }] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [{ ...item("a", 1), state: "nope" }] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [null] })).toBeNull();
  });
  it("rejects plan definitions missing what rows() reads", () => {
    const ok = { contractVersion: "1", kind: "snapshot", watermark: 1, items: [] };
    const def = plan("p", 1, "active", ["a"]).definition.items[0]!;
    const withDef = (d: unknown) => ({ ...ok, plans: [{ ...plan("p", 1), definition: { items: [d], dependencies: [], concurrencyLimit: 1 } }] });
    expect(parseBatch(withDef(def))).not.toBeNull();
    expect(parseBatch(withDef({ ...def, itemId: "" }))).toBeNull();
    expect(parseBatch(withDef({ ...def, issue: { ...issue, issueId: undefined } }))).toBeNull();
    expect(parseBatch(withDef({ ...def, target: { ...target, repository: { integrationId: "forgegraph" } } }))).toBeNull();
    expect(parseBatch(withDef({ ...def, target: { ...target, repository: { repositoryId: "bob" } } }))).toBeNull();
    expect(parseBatch(withDef({ ...def, target: null }))).toBeNull();
  });
  it("sets the ingest body limit to 1,000,000 bytes, matching the exporter", () => {
    expect(MAX_INGEST_BYTES).toBe(1_000_000);
  });
});

describe("DeltaLog", () => {
  const delta = (seq: number) => ({ type: "delta" as const, seq, plans: [], items: [], coordinatorSeenAt: null });
  it("returns the deltas after a cursor only when they run without a gap to the current seq", () => {
    const log = new DeltaLog(2);
    for (const seq of [2, 3, 4]) log.push(delta(seq));
    expect(log.since(3, 4)?.map((d) => d.seq)).toEqual([4]);
    expect(log.since(2, 4)?.map((d) => d.seq)).toEqual([3, 4]);
    expect(log.since(4, 4)).toEqual([]);
    expect(log.since(1, 4)).toBeNull();  // seq 2 and 3: 2 fell out of the log
    expect(log.since(9, 4)).toBeNull();  // ahead of the edge
    expect(log.since(3, 5)).toBeNull();  // seq 5 is missing (it never reached the log)
  });
  it("refuses to bridge a hole inside the log", () => {
    const log = new DeltaLog();
    for (const seq of [2, 3, 5]) log.push(delta(seq));
    expect(log.since(1, 5)).toBeNull();
    expect(log.since(4, 5)?.map((d) => d.seq)).toEqual([5]);
  });
  it("restarts at a snapshot and ignores status messages", () => {
    const log = new DeltaLog();
    log.push(delta(2));
    log.push({ type: "snapshot", epoch: "e", seq: 3, plans: [], items: [], topology: [], coordinatorSeenAt: null });
    log.push({ type: "status", coordinatorSeenAt: 5 });
    expect(log.since(2, 3)).toBeNull();
    expect(log.since(3, 3)).toEqual([]);
  });
});

describe("durableObjectSql", () => {
  it("maps exec to sql.exec(...).toArray() and transaction to transactionSync", () => {
    const calls: unknown[][] = [];
    const storage = {
      sql: { exec: (...args: unknown[]) => { calls.push(args); return { toArray: () => [{ n: 1 }] }; } },
      transactionSync: <T,>(fn: () => T) => { calls.push(["tx"]); return fn(); },
    } as unknown as Parameters<typeof durableObjectSql>[0];
    const port = durableObjectSql(storage);
    expect(port.transaction(() => port.exec("SELECT ? AS n", 1))).toEqual([{ n: 1 }]);
    expect(calls).toEqual([["tx"], ["SELECT ? AS n", 1]]);
  });
});
