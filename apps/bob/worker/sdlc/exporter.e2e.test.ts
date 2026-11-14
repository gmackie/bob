// The real coordinator exporter (packages/bob/coordination/runtime/edge.mjs) feeding the
// edge: exporter → fake fetch → parseBatch → EdgeController.ingest over node:sqlite, with
// a client folding what it receives through reduce().
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyView, reduce, type EdgeMessage, type EdgeView } from "@bob/sdlc-view";
import { EdgeController } from "./controller";
import { MAX_INGEST_BYTES, parseBatch } from "./store";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

// Plain .mjs without type declarations: a computed specifier keeps tsc out of it.
const runtime = new URL("../../../../packages/bob/coordination/runtime/", import.meta.url);
const { Coordinator } = await import(/* @vite-ignore */ new URL("coordinator.mjs", runtime).href);
const { edgeExporter } = await import(/* @vite-ignore */ new URL("edge.mjs", runtime).href);

const target = { environmentId: "hetzner-bob", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const project = { integrationId: "kanbanger", workspaceId: "gmacko", teamId: "GMA", projectId: "bob" };
const context = { workspaceId: "gmacko", actorId: "graham", targets: [target], issueProjects: [project] };
const TOKEN = "t".repeat(40), ENDPOINT = "https://bob.test/api/sdlc/ingest";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0)) fn(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bob-sdlc-e2e-"));
  const coordinator = new Coordinator({ database: join(dir, "coordination.sqlite"), context });
  let clock = 1_000;
  const client = { view: emptyView() as EdgeView, send(data: string) { client.view = reduce(client.view, JSON.parse(data) as EdgeMessage); } };
  const newEdge = () => new EdgeController({ sql: nodeSqlitePort(), sockets: () => [client], now: () => clock });
  let edge = newEdge();
  const responses: number[] = [];
  // What the Task 9 route does with a request body.
  const fetch = async (_url: string, request: { body: string }) => {
    const status = (code: number) => { responses.push(code); return new Response(null, { status: code }); };
    if (Buffer.byteLength(request.body) > MAX_INGEST_BYTES) return status(413);
    const batch = parseBatch(JSON.parse(request.body));
    if (!batch) return status(400);
    try { const result = edge.ingest(batch); responses.push(200); return Response.json(result); }
    catch { return status(500); }
  };
  const exporter = edgeExporter({ coordinator, endpoint: ENDPOINT, token: TOKEN, checkpoint: join(dir, "edge.sqlite"), fetch, now: () => clock });
  cleanups.push(() => { exporter.close(); coordinator.close(); rmSync(dir, { recursive: true, force: true }); });
  const create = (commandId: string, itemId: string): string => coordinator.call("CreatePlan", { contractVersion: "1", commandId, plan: { items: [{ itemId, issue: { ...project, issueId: `issue-${itemId}` }, target, issueSnapshotRef: `snap-${itemId}`, completionTarget: "production" }], dependencies: [], concurrencyLimit: 2 } }, { idempotencyKey: commandId }).resourceId;
  const cancel = (commandId: string, planId: string, expectedVersion: number) => coordinator.call("ControlPlan", { contractVersion: "1", commandId, planId, expectedVersion, action: "cancel" }, { idempotencyKey: commandId });
  return {
    coordinator, exporter, client, responses, create, cancel,
    get edge() { return edge; },
    resetEdge: () => { edge = newEdge(); },
    tick: (ms: number) => { clock += ms; },
    ids: (view: { plans: Record<string, unknown> | Array<{ planId: string }>; items: Record<string, unknown> | Array<{ itemId: string }> }) => ({
      plans: (Array.isArray(view.plans) ? view.plans.map((p) => p.planId) : Object.keys(view.plans)).sort(),
      items: (Array.isArray(view.items) ? view.items.map((i) => i.itemId) : Object.keys(view.items)).sort(),
    }),
  };
}

describe("coordinator exporter → SDLC edge", () => {
  it("carries a snapshot, then changes, then an eviction, then a forced resync to a connected client", async () => {
    const f = fixture();
    f.edge.hello(f.client, { cursor: null, epoch: null });

    const first = f.create("c1", "item-1");
    expect(await f.exporter.flush()).toEqual({ kind: "snapshot", sent: 2 });
    expect(f.ids(f.client.view)).toEqual({ plans: [first], items: ["item-1"] });
    expect(f.edge.store.meta().watermark).toBe(f.coordinator.watermark());

    const second = f.create("c2", "item-2");
    expect(await f.exporter.flush()).toMatchObject({ kind: "changes" });
    expect(f.ids(f.client.view)).toEqual({ plans: [first, second].sort(), items: ["item-1", "item-2"] });

    // Cancelling a draft plan finishes it: the edge evicts it and its item, everywhere.
    f.cancel("c3", first, 1);
    expect(await f.exporter.flush()).toMatchObject({ kind: "changes" });
    expect(f.ids(f.client.view)).toEqual({ plans: [second], items: ["item-2"] });
    expect(f.ids(f.edge.store.snapshot(null))).toEqual({ plans: [second], items: ["item-2"] });

    // Nothing new: after 30 s the exporter sends a heartbeat, which the edge accepts.
    f.tick(31_000);
    expect(await f.exporter.flush()).toEqual({ kind: "heartbeat", sent: 0 });
    expect(f.client.view.coordinatorSeenAt).toBe(32_000);

    // The edge loses its storage. The next changes batch starts past its watermark, so
    // it asks for a resync; the exporter drops its checkpoint and sends a snapshot.
    const epoch = f.client.view.epoch;
    f.resetEdge();
    const third = f.create("c4", "item-3");
    await expect(f.exporter.flush()).rejects.toThrow(/fresh snapshot/);
    expect(await f.exporter.flush()).toMatchObject({ kind: "snapshot" });
    expect(f.edge.store.meta().watermark).toBe(f.coordinator.watermark());

    // The client's cursor is from the old edge's epoch, so it is sent a snapshot.
    const reconnecting = { view: f.client.view, send(data: string) { reconnecting.view = reduce(reconnecting.view, JSON.parse(data) as EdgeMessage); } };
    f.edge.hello(reconnecting, { cursor: f.client.view.seq, epoch });
    expect(reconnecting.view.epoch).not.toBe(epoch);
    expect(f.ids(reconnecting.view)).toEqual({ plans: [second, third].sort(), items: ["item-2", "item-3"] });
    expect(f.ids(f.client.view)).toEqual(f.ids(reconnecting.view)); // the connected client got the snapshot broadcast too
    expect(f.responses).toEqual([200, 200, 200, 200, 200, 200]);
  });
});
