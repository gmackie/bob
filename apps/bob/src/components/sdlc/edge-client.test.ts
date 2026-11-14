import { describe, expect, it } from "vitest";
import type { EdgeMessage, ItemSnapshot, PlanSnapshot } from "@bob/sdlc-view";
import { EdgeController } from "../../../worker/sdlc/controller";
import type { IngestBatch } from "../../../worker/sdlc/store";
import { nodeSqlitePort } from "../../../worker/sdlc/test-helpers/node-sqlite";
import { createBackoff, createEdgeClient, helloFor, parseEdgeMessage, reconnectDelay } from "./edge-client";
import { edgeSocketUrl } from "./use-sdlc-edge";

const target = { environmentId: "hetzner-bob", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const issue = { integrationId: "kanbanger", workspaceId: "gmacko", teamId: "GMA", projectId: "bob", issueId: "i1" };
const plan = (resourceVersion = 1): PlanSnapshot => ({
  planId: "p", resourceVersion, state: "active",
  definition: { items: [{ itemId: "a", issue, target, completionTarget: "production" }], dependencies: [], concurrencyLimit: 1 },
});
const item = (itemId: string, resourceVersion: number, state: ItemSnapshot["state"] = "ready"): ItemSnapshot =>
  ({ itemId, planId: "p", resourceVersion, state, currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] });

const snapshot = (seq: number, items: ItemSnapshot[] = []): EdgeMessage => ({ type: "snapshot", epoch: "e1", seq, plans: [plan()], items, topology: [], coordinatorSeenAt: 1 });
const delta = (seq: number, items: ItemSnapshot[] = []): EdgeMessage => ({ type: "delta", seq, plans: [], items, coordinatorSeenAt: 2 });
const wire = (m: EdgeMessage) => JSON.stringify(m);

function harness() {
  const sent: unknown[] = [];
  const views: unknown[] = [];
  const client = createEdgeClient({ send: (d) => sent.push(JSON.parse(d)), onView: (v) => views.push(v) });
  return { client, sent, views };
}

describe("helloFor", () => {
  it("asks for a snapshot without a view, and resumes from seq and epoch with one", () => {
    const h = harness();
    expect(helloFor(h.client.view)).toEqual({ type: "hello", cursor: null, epoch: null });
    h.client.received(wire(snapshot(4)));
    expect(helloFor(h.client.view)).toEqual({ type: "hello", cursor: 4, epoch: "e1" });
  });
});

describe("createEdgeClient", () => {
  it("says hello on open with the last seq and epoch, null on the first connect", () => {
    const h = harness();
    h.client.opened();
    h.client.received(wire(snapshot(3)));
    h.client.received(wire(delta(4, [item("a", 2)])));
    h.client.opened(); // a reconnect
    expect(h.sent).toEqual([
      { type: "hello", cursor: null, epoch: null },
      { type: "hello", cursor: 4, epoch: "e1" },
    ]);
    expect(h.client.view.items.a?.resourceVersion).toBe(2);
    expect(h.views).toHaveLength(2);
  });

  it("sends one snapshot request on a seq gap, and asks again only after the snapshot clears it", () => {
    const h = harness();
    h.client.opened();
    h.client.received(wire(snapshot(1)));
    h.client.received(wire(delta(3)));
    expect(h.client.view.needsResync).toBe(true);
    h.client.received(wire(delta(5)));
    expect(h.sent.slice(1)).toEqual([{ type: "hello", cursor: null, epoch: null }]);
    h.client.received(wire(snapshot(6)));
    expect(h.client.view.needsResync).toBe(false);
    h.client.received(wire(delta(8)));
    expect(h.sent.slice(1)).toEqual([{ type: "hello", cursor: null, epoch: null }, { type: "hello", cursor: null, epoch: null }]);
  });

  it("asks for a snapshot in the hello of a new socket when the view still needs a resync, and not twice", () => {
    const h = harness();
    h.client.opened();
    h.client.received(wire(snapshot(1)));
    h.client.received(wire(delta(3)));
    h.client.opened();
    h.client.received(wire(delta(4)));
    expect(h.sent).toEqual([
      { type: "hello", cursor: null, epoch: null },
      { type: "hello", cursor: null, epoch: null }, // the gap
      { type: "hello", cursor: null, epoch: null }, // the reconnect
    ]);
  });

  it("reports whether a message was a valid edge message, so the caller resets backoff only then", () => {
    const h = harness();
    h.client.opened();
    expect(h.client.received("garbage")).toBe(false);
    expect(h.client.received(wire(snapshot(1)))).toBe(true);
    expect(h.client.received(wire({ type: "status", coordinatorSeenAt: 3 }))).toBe(true);
  });

  it("ignores what is not an edge message", () => {
    const h = harness();
    for (const data of ["not json", "null", JSON.stringify({ type: "delta" }), JSON.stringify({ type: "snapshot", seq: 1, plans: [], items: [] }), new ArrayBuffer(2)]) h.client.received(data);
    expect(h.views).toEqual([]);
    expect(parseEdgeMessage(wire(delta(1)))).toEqual(delta(1));
  });

  it("recovers a dropped delta from the real edge controller", () => {
    let drop = false;
    let client!: ReturnType<typeof createEdgeClient>;
    const socket = { send: (d: string) => { if (!drop) client.received(d); } };
    const edge = new EdgeController({ sql: nodeSqlitePort(), sockets: () => [socket], now: () => 5_000, newEpoch: () => "epoch-1" });
    client = createEdgeClient({ send: (d) => { const h = JSON.parse(d) as { cursor: number | null; epoch: string | null }; edge.hello(socket, h); } });
    const batch = (b: Partial<IngestBatch>): IngestBatch => ({ contractVersion: "1", kind: "changes", watermark: 0, plans: [], items: [], ...b });

    client.opened();
    edge.ingest(batch({ kind: "snapshot", watermark: 1, plans: [plan()], items: [item("a", 1)] }));
    drop = true;
    edge.ingest(batch({ fromSequence: 1, watermark: 2, items: [item("a", 2, "reserved")] }));
    drop = false;
    edge.ingest(batch({ fromSequence: 2, watermark: 3, items: [item("b", 1)] }));
    // The gap was noticed, a snapshot was asked for and applied.
    expect(client.view.needsResync).toBe(false);
    expect(client.view.items.a).toMatchObject({ resourceVersion: 2, state: "reserved" });
    expect(client.view.epoch).toBe("epoch-1");
  });
});

describe("reconnectDelay and edgeSocketUrl", () => {
  it("backs off exponentially up to 30 s, with ±20% jitter", () => {
    const mid = (attempt: number) => reconnectDelay(attempt, () => 0.5);
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(mid)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(reconnectDelay(2, () => 0)).toBe(3_200);
    expect(reconnectDelay(2, () => 1)).toBe(4_800);
    expect(reconnectDelay(9, () => 1)).toBe(36_000);
    for (let i = 0; i < 50; i++) {
      const d = reconnectDelay(3);
      expect(d).toBeGreaterThanOrEqual(6_400);
      expect(d).toBeLessThanOrEqual(9_600);
    }
  });
  it("keeps backing off across sockets that open but never deliver, and resets after a valid message", () => {
    const backoff = createBackoff(() => 0.5);
    // Socket opens, closes without a message, three times: open alone does not reset.
    expect([backoff.nextDelay(), backoff.nextDelay(), backoff.nextDelay()]).toEqual([1_000, 2_000, 4_000]);
    backoff.heard();
    expect(backoff.nextDelay()).toBe(1_000);
  });
  it("uses wss on https and ws on http, same origin", () => {
    expect(edgeSocketUrl("https://blder.bot/sdlc?x=1")).toBe("wss://blder.bot/api/sdlc/ws");
    expect(edgeSocketUrl("http://localhost:3000/sdlc")).toBe("ws://localhost:3000/api/sdlc/ws");
  });
});
