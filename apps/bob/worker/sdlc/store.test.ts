import { describe, expect, it } from "vitest";
import type { PlanSnapshot } from "@bob/sdlc-view";
import { applyBatch, DeltaLog, emptyEdge, helloReply, parseBatch, snapshotOf, type IngestBatch } from "./store";

const item = (itemId: string, resourceVersion: number, state = "ready", planId = "p") =>
  ({ itemId, planId, resourceVersion, state, currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] }) as IngestBatch["items"][number];
const plan = (planId: string, resourceVersion: number, state: PlanSnapshot["state"] = "active"): PlanSnapshot =>
  ({ planId, resourceVersion, state, definition: { items: [], dependencies: [], concurrencyLimit: 1 } });
const batch = (b: Partial<IngestBatch>): IngestBatch => ({ contractVersion: "1", kind: "changes", watermark: 0, plans: [], items: [], ...b });

describe("applyBatch", () => {
  it("accepts a snapshot and sets the watermark", () => {
    const { state, result, message } = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 4, items: [item("a", 1)] }), 100);
    expect(result).toEqual({ accepted: true, watermark: 4 });
    expect(state.watermark).toBe(4); expect(message?.type).toBe("snapshot");
  });
  it("asks for a resync when changes start past its watermark", () => {
    const first = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 4 }), 100).state;
    expect(applyBatch(first, batch({ fromSequence: 9, watermark: 12 }), 200).result).toEqual({ accepted: false, resync: true });
    expect(applyBatch(first, batch({ kind: "heartbeat", watermark: 9 }), 200).result).toEqual({ accepted: false, resync: true });
  });
  it("applies contiguous changes and records when the coordinator was last heard from", () => {
    const first = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 4, items: [item("a", 1)] }), 100).state;
    const next = applyBatch(first, batch({ fromSequence: 4, watermark: 6, items: [item("a", 2, "running")] }), 200);
    expect(next.state.view.items.a?.state).toBe("running");
    expect(next.state.view.coordinatorSeenAt).toBe(200);
    expect(next.message).toMatchObject({ type: "delta", seq: 2 });
  });
  it("accepts an empty changes batch (every resource out of policy) and advances the watermark without a delta", () => {
    const first = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 4 }), 100).state;
    const next = applyBatch(first, batch({ fromSequence: 4, watermark: 7 }), 200);
    expect(next.result).toEqual({ accepted: true, watermark: 7 });
    expect(next.state.watermark).toBe(7);
    expect(next.state.view.seq).toBe(first.view.seq);
    expect(next.message).toEqual({ type: "status", coordinatorSeenAt: 200 });
    expect(next.state.view.coordinatorSeenAt).toBe(200);
  });
  it("re-accepts a replayed batch (lost response) with that batch's watermark and never moves its own watermark back", () => {
    let state = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 4, items: [item("a", 1)] }), 100).state;
    state = applyBatch(state, batch({ fromSequence: 4, watermark: 6, items: [item("a", 3, "running")] }), 200).state;
    const replay = applyBatch(state, batch({ fromSequence: 4, watermark: 5, items: [item("a", 2, "reserved")] }), 300);
    expect(replay.result).toEqual({ accepted: true, watermark: 5 }); // the exporter checks result.watermark === batch.watermark
    expect(replay.state.watermark).toBe(6);
    expect(replay.state.view.items.a?.state).toBe("running"); // older resourceVersion does not win
  });
  it("evicts a plan and its items when a change reports it terminal, so later snapshots leave it out", () => {
    let state = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 1, plans: [plan("p", 1)], items: [item("a", 1)] }), 1).state;
    state = applyBatch(state, batch({ fromSequence: 1, watermark: 2, plans: [plan("p", 2, "completed")] }), 2).state;
    const snap = snapshotOf(state);
    expect(snap).toMatchObject({ type: "snapshot", plans: [], items: [] });
  });
  it("keeps the topology across a coordinator snapshot", () => {
    const start = { ...emptyEdge(), view: { ...emptyEdge().view, topology: [{ startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" }] } };
    const { state, message } = applyBatch(start, batch({ kind: "snapshot", watermark: 1 }), 1);
    expect(state.view.topology).toHaveLength(1);
    expect(message).toMatchObject({ type: "snapshot", topology: [{ startupId: "s1" }] });
  });
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
  it("rejects plans and items the view could not index", () => {
    const ok = { contractVersion: "1", kind: "snapshot", watermark: 1 };
    expect(parseBatch({ ...ok, plans: [plan("p", 1)], items: [item("a", 1)] })).not.toBeNull();
    expect(parseBatch({ ...ok, plans: [{ planId: "p", resourceVersion: 1, state: "active" }], items: [] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [{ ...plan("p", 1), state: "gone" }], items: [] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [{ ...item("a", 1), planId: 3 }] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [{ ...item("a", 1), resourceVersion: "1" }] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [{ ...item("a", 1), state: "nope" }] })).toBeNull();
    expect(parseBatch({ ...ok, plans: [], items: [null] })).toBeNull();
  });
});

describe("helloReply", () => {
  it("sends only the missing deltas to a client that is close behind, otherwise a snapshot", () => {
    const log = new DeltaLog(2);
    let state = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 1 }), 1).state;
    for (let w = 2; w <= 4; w++) {
      const r = applyBatch(state, batch({ fromSequence: w - 1, watermark: w, items: [item("a", w)] }), w);
      state = r.state; if (r.message) log.push(r.message);
    }
    expect(helloReply(state, log, 3).map((m) => m.type)).toEqual(["delta"]);   // seq 4 only
    expect(helloReply(state, log, 4)).toEqual([]);
    expect(helloReply(state, log, 1).map((m) => m.type)).toEqual(["snapshot"]); // fell out of the log
    expect(helloReply(state, log, null).map((m) => m.type)).toEqual(["snapshot"]);
  });
  it("sends a snapshot to a client whose cursor is ahead of the edge", () => {
    const state = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 1 }), 1).state;
    expect(helloReply(state, new DeltaLog(), 9).map((m) => m.type)).toEqual(["snapshot"]);
  });
  it("ignores status messages in the log, which carry no seq", () => {
    const log = new DeltaLog();
    log.push({ type: "status", coordinatorSeenAt: 5 });
    const state = applyBatch(emptyEdge(), batch({ kind: "snapshot", watermark: 1 }), 1).state;
    expect(helloReply(state, log, state.view.seq)).toEqual([]);
  });
});
