import { describe, expect, it } from "vitest";
import type { TopologyRepo, TrackedIssue } from "@bob/sdlc-view";
import { EdgeController, type EdgeControllerOptions } from "./controller";
import type { IngestBatch } from "./store";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

const bob: TopologyRepo = { startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" };
const pulse: TopologyRepo = { startupId: "s2", startupName: "Pulse", repoSlug: "gmackie/pulse" };
const item = (itemId: string, resourceVersion: number) =>
  ({ itemId, planId: "p", resourceVersion, state: "ready", currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] }) as IngestBatch["items"][number];

function harness(options: Partial<EdgeControllerOptions> = {}) {
  const sql = nodeSqlitePort();
  let clock = 1_000;
  const sockets: Array<{ sent: string[]; send(d: string): void }> = [];
  const socket = () => { const s = { sent: [] as string[], send(d: string) { s.sent.push(d); } }; sockets.push(s); return s; };
  const background: Array<Promise<unknown>> = [];
  const make = (extra: Partial<EdgeControllerOptions> = {}) => new EdgeController({
    sql, sockets: () => sockets, now: () => clock, newEpoch: () => "epoch-1",
    loadTopology: async () => [bob], schedule: (work) => { background.push(work); },
    ...options, ...extra,
  });
  return { sql, make, socket, sockets, background, settle: () => Promise.all(background.splice(0)), tick: (ms: number) => { clock += ms; }, get clock() { return clock; } };
}
const batch = (b: Partial<IngestBatch>): IngestBatch => ({ contractVersion: "1", kind: "changes", watermark: 0, plans: [], items: [], ...b });
const parsed = (s: { sent: string[] }) => s.sent.map((d) => JSON.parse(d));
const types = (s: { sent: string[] }) => parsed(s).map((m) => m.type);
const WRITES = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i;

describe("EdgeController.ingest", () => {
  it("stores accepted batches and broadcasts them to connected clients", () => {
    const h = harness(), edge = h.make(), client = h.socket();
    expect(edge.ingest(batch({ kind: "snapshot", watermark: 2 }))).toEqual({ accepted: true, watermark: 2, commands: [] });
    expect(types(client)).toEqual(["snapshot"]);
    expect(edge.store.meta().watermark).toBe(2);
  });
  it("neither stores nor broadcasts a batch it must resync", () => {
    const h = harness(), edge = h.make(), client = h.socket();
    expect(edge.ingest(batch({ fromSequence: 5, watermark: 6 }))).toEqual({ accepted: false, resync: true, commands: [] });
    expect(client.sent).toEqual([]); expect(edge.store.meta()).toMatchObject({ watermark: 0, seq: 0 });
  });
  it("answers a heartbeat with a status broadcast and writes nothing", () => {
    const h = harness(), edge = h.make(), client = h.socket();
    edge.ingest(batch({ kind: "snapshot", watermark: 2 }));
    const writes = h.sql.statements.length;
    h.tick(500);
    expect(edge.ingest(batch({ kind: "heartbeat", watermark: 2 }))).toEqual({ accepted: true, watermark: 2, commands: [] });
    expect(parsed(client).at(-1)).toEqual({ type: "status", coordinatorSeenAt: 1_500 });
    expect(h.sql.statements.slice(writes).filter((q) => WRITES.test(q))).toEqual([]);
  });
  it("sends a status for an accepted batch with nothing to apply, but nothing for a covered replay", () => {
    const h = harness(), edge = h.make(), client = h.socket();
    edge.ingest(batch({ kind: "snapshot", watermark: 2 }));
    edge.ingest(batch({ fromSequence: 2, watermark: 4 }));
    expect(types(client)).toEqual(["snapshot", "status"]);
    edge.ingest(batch({ fromSequence: 2, watermark: 3, items: [item("a", 1)] }));
    expect(types(client)).toEqual(["snapshot", "status"]);
  });
  it("leaves memory, log and storage as they were when storage fails, so the retry continues the same history", () => {
    const h = harness(), edge = h.make(), watcher = h.socket();
    edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    edge.ingest(batch({ fromSequence: 1, watermark: 2, items: [item("a", 1)] }));
    const seq = edge.store.meta().seq;
    h.sql.failNext(/INTO items/);
    const change = batch({ fromSequence: 2, watermark: 3, items: [item("a", 2)] });
    expect(() => edge.ingest(change)).toThrow(/injected/);
    expect(edge.store.meta()).toMatchObject({ watermark: 2, seq });
    expect(types(watcher)).toEqual(["snapshot", "delta"]);
    // A client at seq is still told it is current, and that is true.
    const resumer = h.socket(); edge.hello(resumer, { cursor: seq, epoch: "epoch-1" });
    expect(types(resumer)).toEqual(["status"]);
    expect(edge.ingest(change)).toMatchObject({ accepted: true, watermark: 3 });
    expect(parsed(resumer).at(-1)).toMatchObject({ type: "delta", seq: seq + 1 });
  });
});

describe("EdgeController.ingestIssues (BOB-99)", () => {
  const issue = (id: string, version: number): TrackedIssue => ({
    id, key: `BOB-${id}`, title: "t", url: null, state: { name: "Todo", type: "unstarted" }, project: null, team: null, updatedAt: version, pr: null, dispatchable: false, version,
  });
  it("broadcasts changed issues as a delta, resumes them by cursor, and puts them in snapshots", () => {
    const h = harness(), edge = h.make(), client = h.socket();
    edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    expect(edge.ingestIssues({ contractVersion: "1", upserts: [issue("1", 5)] })).toEqual({ accepted: true, stored: 1, removed: 0 });
    expect(parsed(client).at(-1)).toMatchObject({ type: "delta", seq: 2, issues: [{ id: "1" }] });
    expect(edge.ingestIssues({ contractVersion: "1", upserts: [issue("1", 5)] })).toEqual({ accepted: true, stored: 0, removed: 0 });
    expect(parsed(client)).toHaveLength(2);
    const late = h.socket(); edge.hello(late, { cursor: 1, epoch: "epoch-1" });
    expect(parsed(late)[0]).toMatchObject({ type: "delta", seq: 2, issues: [{ id: "1" }] });
    const fresh = h.socket(); edge.hello(fresh, { cursor: null, epoch: null });
    expect(parsed(fresh)[0]).toMatchObject({ type: "snapshot", issues: [{ id: "1" }] });
  });
});

describe("EdgeController.hello", () => {
  it("replies before BizPulse answers, then broadcasts the new topology to every client", async () => {
    let release!: (repos: TopologyRepo[]) => void;
    const h = harness({ loadTopology: () => new Promise((resolve) => { release = resolve; }) });
    const edge = h.make();
    edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const other = h.socket(), client = h.socket();
    edge.hello(client, { cursor: null, epoch: null });
    expect(parsed(client)).toEqual([
      expect.objectContaining({ type: "snapshot", epoch: "epoch-1", seq: 1, topology: [] }),
      { type: "status", coordinatorSeenAt: 1_000 },
    ]);
    release([bob]);
    await h.settle();
    for (const s of [client, other]) expect(parsed(s).at(-1)).toMatchObject({ type: "snapshot", seq: 2, topology: [bob] });
  });
  it("resumes a client from its cursor with only the deltas it missed, then a status", () => {
    const h = harness(), edge = h.make();
    edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    edge.ingest(batch({ fromSequence: 1, watermark: 2, items: [item("a", 1)] }));
    edge.ingest(batch({ fromSequence: 2, watermark: 3, items: [item("a", 2)] }));
    const client = h.socket(); edge.hello(client, { cursor: 2, epoch: "epoch-1" });
    expect(parsed(client).map((m) => [m.type, m.seq])).toEqual([["delta", 3], ["status", undefined]]);
  });
  it("sends a snapshot when the client's epoch is from another edge history", () => {
    const h = harness(), edge = h.make();
    edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const client = h.socket(); edge.hello(client, { cursor: 1, epoch: "epoch-0" });
    expect(types(client)).toEqual(["snapshot", "status"]);
  });
  it("still serves the stored state after a restart (no delta log, so a snapshot)", () => {
    const h = harness();
    h.make().ingest(batch({ kind: "snapshot", watermark: 3 }));
    h.make().ingest(batch({ fromSequence: 3, watermark: 4, items: [item("a", 1)] }));
    const client = h.socket(); h.make().hello(client, { cursor: 1, epoch: "epoch-1" });
    expect(types(client)).toEqual(["snapshot", "status"]);
    expect(parsed(client)[0]).toMatchObject({ seq: 2, items: [{ itemId: "a" }] });
  });
  it("keeps the last topology when BizPulse fails, and waits a minute before asking again", async () => {
    let fail = false, calls = 0;
    const h = harness({ loadTopology: async () => { calls++; if (fail) throw new Error("down"); return [bob]; } });
    const edge = h.make();
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    fail = true; h.tick(5 * 60_000);
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    expect(calls).toBe(2);
    h.tick(30_000);
    const client = h.socket(); edge.hello(client, { cursor: null, epoch: null }); await h.settle();
    expect(calls).toBe(2);
    expect(parsed(client)[0].topology).toEqual([bob]);
    h.tick(31_000); fail = false;
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    expect(calls).toBe(3);
  });
  it("does not ask BizPulse again within five minutes of a good answer", async () => {
    let calls = 0;
    const h = harness({ loadTopology: async () => { calls++; return [bob]; } });
    const edge = h.make();
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    h.tick(4 * 60_000);
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    expect(calls).toBe(1);
  });
  it("does not resend a snapshot when BizPulse returns the same repos in another order", async () => {
    let repos = [bob, pulse];
    const h = harness({ loadTopology: async () => repos });
    const edge = h.make();
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    const watcher = h.socket(), seq = edge.store.meta().seq;
    repos = [pulse, bob]; h.tick(5 * 60_000);
    edge.hello(h.socket(), { cursor: null, epoch: null }); await h.settle();
    expect(watcher.sent).toEqual([]);
    expect(edge.store.meta().seq).toBe(seq);
  });
  it("asks BizPulse once when several clients connect at the same time", async () => {
    let calls = 0;
    const h = harness({ loadTopology: async () => { calls++; return [bob]; } });
    const edge = h.make();
    edge.hello(h.socket(), { cursor: null, epoch: null });
    edge.hello(h.socket(), { cursor: null, epoch: null });
    await h.settle();
    expect(calls).toBe(1);
  });
  it("ends every reply with a status carrying when the coordinator was last heard from", () => {
    const h = harness(), edge = h.make();
    const fresh = h.socket(); edge.hello(fresh, { cursor: null, epoch: null });
    expect(parsed(fresh).at(-1)).toEqual({ type: "status", coordinatorSeenAt: null });
    h.tick(10); edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const current = h.socket(); edge.hello(current, { cursor: 1, epoch: "epoch-1" });
    expect(parsed(current)).toEqual([{ type: "status", coordinatorSeenAt: 1_010 }]);
  });
});
