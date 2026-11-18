// BOB-95: the edge's shipped record — written in the ingest transaction, pruned, and sent to opted-in viewer sockets.
import { describe, expect, it } from "vitest";
import { MAX_SHIPPED_ENTRIES, SHIPPED_WINDOW_MS, type ItemSnapshot, type Milestone, type PlanSnapshot, type ShippedEntry } from "@bob/sdlc-view";
import { EdgeController } from "./controller";
import { attachUser, greet, greetedSockets, readAttachment } from "./edge-sockets";
import { parseShippedRequest, ShippedEdge } from "./shipped";
import type { IngestBatch } from "./store";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

const target = (repositoryId = "bob") => ({ environmentId: "e", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId } });
const plan = (planId = "p1", ids = ["i1", "i2"], rv = 1, state: PlanSnapshot["state"] = "active"): PlanSnapshot => ({
  planId, resourceVersion: rv, state,
  definition: {
    items: ids.map((itemId) => ({ itemId, issue: { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: itemId, identifier: `BOB-${itemId}` }, target: target(), completionTarget: "production-verified" })),
    dependencies: [], concurrencyLimit: 1,
  },
});
const item = (itemId: string, rv: number, milestones: Milestone[] = [], planId = "p1"): ItemSnapshot => ({
  itemId, planId, resourceVersion: rv, state: milestones.includes("production-verified") ? "completed" : "deploying",
  achievedMilestones: milestones, operationIds: [], evidenceRefs: [],
});
const SHIPPED: Milestone[] = ["execution-succeeded", "review-ready", "merged", "production-verified"];

function fakeSocket() {
  let attachment: unknown = null;
  const socket = {
    sent: [] as string[],
    send(data: string) { socket.sent.push(data); },
    serializeAttachment(value: unknown) { attachment = structuredClone(value); },
    deserializeAttachment() { return attachment; },
  };
  return socket;
}
type Socket = ReturnType<typeof fakeSocket>;
const messages = (s: Socket) => s.sent.map((d) => JSON.parse(d) as { type: string; replace?: boolean; entries?: ShippedEntry[] });

function harness(start: { plans?: PlanSnapshot[]; items?: ItemSnapshot[] } = {}) {
  let clock = 1_000_000;
  let watermark = 0;
  const all: Socket[] = [];
  const sql = nodeSqlitePort();
  let viewers = "u1";
  const published: ShippedEntry[][] = [];
  let edge!: ShippedEdge;
  const controller = new EdgeController({
    sql, sockets: () => greetedSockets(all), now: () => clock, newEpoch: () => "e1",
    onShipped: (entries) => { published.push(entries); edge.publish(entries); },
  });
  edge = new ShippedEdge({ sockets: () => all, recent: (now) => controller.store.shipped.recent(now), viewerIds: () => viewers, now: () => clock });
  const ingest = (b: Partial<IngestBatch>) => {
    const from = watermark;
    watermark++;
    return controller.ingest({ contractVersion: "1", kind: "changes", fromSequence: from, watermark, plans: [], items: [], ...b });
  };
  ingest({ kind: "snapshot", plans: start.plans ?? [plan()], items: start.items ?? [item("i1", 1), item("i2", 1)] });
  const connect = (userId: string | null, greeted = true) => {
    const s = fakeSocket();
    attachUser(s, userId);
    all.push(s);
    if (greeted) greet(controller, s, { cursor: null, epoch: null }, () => {});
    s.sent.length = 0;
    return s;
  };
  return {
    controller, edge, ingest, connect, published, sql,
    tick: (ms: number) => { clock += ms; },
    now: () => clock,
    setViewers: (v: string) => { viewers = v; },
  };
}

describe("shipped ledger (BOB-95)", () => {
  it("records an item the first time it gains production-verified, with its issue and repository", () => {
    const h = harness();
    h.tick(5);
    h.ingest({ items: [item("i1", 2, ["merged"])] });
    expect(h.published).toEqual([]);
    h.ingest({ items: [item("i1", 3, SHIPPED)] });
    expect(h.published).toEqual([[{ itemId: "i1", planId: "p1", issue: "BOB-i1", repository: "bob", at: 1_000_005 }]]);
    // A later version of the same item, a replayed snapshot: no second entry.
    h.ingest({ items: [item("i1", 4, SHIPPED)] });
    h.ingest({ kind: "snapshot", fromSequence: undefined, plans: [plan()], items: [item("i1", 5, SHIPPED), item("i2", 1)] });
    expect(h.published).toHaveLength(1);
    expect(h.controller.store.shipped.recent(h.now())).toHaveLength(1);
  });

  it("does not record what a fresh edge's first snapshot already shows as shipped", () => {
    const h = harness({ items: [item("i1", 1, SHIPPED), item("i2", 1)] });
    expect(h.published).toEqual([]);
    expect(h.controller.store.shipped.recent(h.now())).toEqual([]);
  });

  it("keeps the entry after the item's plan ends and leaves the view", () => {
    const h = harness();
    h.ingest({ items: [item("i1", 2, SHIPPED)] });
    h.ingest({ plans: [plan("p1", ["i1", "i2"], 2, "completed")] });
    expect(h.controller.store.item("i1")).toBeUndefined();
    expect(h.controller.store.shipped.recent(h.now()).map((e) => e.itemId)).toEqual(["i1"]);
  });

  it("prunes entries older than the window and past the cap", () => {
    const h = harness();
    h.ingest({ items: [item("i1", 2, SHIPPED)] });
    h.tick(SHIPPED_WINDOW_MS + 1);
    expect(h.controller.store.shipped.recent(h.now())).toEqual([]);
    h.ingest({ items: [item("i2", 2, SHIPPED)] });
    expect(h.sql.exec<{ item_id: string }>("SELECT item_id FROM sdlc_shipped").map((r) => r.item_id)).toEqual(["i2"]);

    const ids = Array.from({ length: MAX_SHIPPED_ENTRIES + 3 }, (_, i) => `n${String(i).padStart(4, "0")}`);
    h.ingest({ plans: [plan("p2", ids)], items: ids.map((id) => item(id, 1, [], "p2")) });
    for (const id of ids) { h.tick(1); h.ingest({ items: [item(id, 2, SHIPPED, "p2")] }); }
    const kept = h.controller.store.shipped.recent(h.now());
    expect(kept).toHaveLength(MAX_SHIPPED_ENTRIES);
    expect(kept[0]!.itemId).toBe(ids.at(-1));
  });

  it("an item new to the edge that arrives already shipped is recorded", () => {
    const h = harness();
    h.ingest({ plans: [plan("p3", ["fast"])], items: [item("fast", 1, SHIPPED, "p3")] });
    expect(h.published.flat().map((e) => e.itemId)).toEqual(["fast"]);
  });
});

describe("shipped opt-in over the socket (BOB-95)", () => {
  it("parses the request strictly", () => {
    expect(parseShippedRequest('{"type":"shipped"}')).toBe(true);
    for (const bad of ['{"type":"watch"}', "[]", "nope", `{"type":"shipped","x":"${"y".repeat(80)}"}`]) expect(parseShippedRequest(bad)).toBe(false);
    expect(parseShippedRequest(new ArrayBuffer(2))).toBe(false);
  });

  it("answers a request with the full list, then sends new entries only to opted-in sockets", () => {
    const h = harness();
    h.ingest({ items: [item("i1", 2, SHIPPED)] });
    const asked = h.connect("u1"), quiet = h.connect("u1");
    expect(h.edge.request(asked)).toBe(true);
    expect(messages(asked)).toEqual([{ type: "shipped", replace: true, entries: [expect.objectContaining({ itemId: "i1" })] }]);
    expect(readAttachment(asked).shipped).toBe(true);
    asked.sent.length = 0;
    h.ingest({ items: [item("i2", 2, SHIPPED)] });
    expect(messages(asked).filter((m) => m.type === "shipped")).toEqual([{ type: "shipped", replace: false, entries: [expect.objectContaining({ itemId: "i2" })] }]);
    expect(messages(quiet).some((m) => m.type === "shipped")).toBe(false);
  });

  it("refuses sockets that may not watch, and re-checks the allow-list on fan-out", () => {
    const h = harness();
    const ungreeted = h.connect("u1", false), anon = h.connect(null), stranger = h.connect("u9");
    for (const s of [ungreeted, anon, stranger]) {
      expect(h.edge.request(s)).toBe(false);
      expect(s.sent).toEqual([]);
    }
    const viewer = h.connect("u1");
    h.edge.request(viewer);
    viewer.sent.length = 0;
    h.setViewers("u2");
    h.ingest({ items: [item("i1", 2, SHIPPED)] });
    expect(messages(viewer).some((m) => m.type === "shipped")).toBe(false);
  });
});
