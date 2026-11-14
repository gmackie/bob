import { describe, expect, it } from "vitest";
import type { TopologyRepo } from "@bob/sdlc-view";
import { EdgeController } from "./controller";
import type { EdgeState, IngestBatch } from "./store";

function harness(now = () => 1_000, topology = async (): Promise<TopologyRepo[]> => [{ startupId: "s1", startupName: "Bob", repoSlug: "gmackie/bob" }]) {
  let stored: EdgeState | undefined;
  const sockets: Array<{ sent: string[]; send(d: string): void }> = [];
  const socket = () => { const s = { sent: [] as string[], send(d: string) { s.sent.push(d); } }; sockets.push(s); return s; };
  const storage = { get: async () => stored, put: async (s: EdgeState) => { stored = structuredClone(s); } };
  const make = () => new EdgeController(storage, () => sockets, now, topology);
  return { make, socket, sockets, stored: () => stored };
}
const batch = (b: Partial<IngestBatch>): IngestBatch => ({ contractVersion: "1", kind: "changes", watermark: 0, plans: [], items: [], ...b });
const types = (s: { sent: string[] }) => s.sent.map((d) => JSON.parse(d).type);
const last = (s: { sent: string[] }) => JSON.parse(s.sent.at(-1)!);

describe("EdgeController", () => {
  it("persists accepted batches and broadcasts them to connected clients", async () => {
    const h = harness(), edge = h.make(), client = h.socket();
    expect(await edge.ingest(batch({ kind: "snapshot", watermark: 2 }))).toEqual({ accepted: true, watermark: 2 });
    expect(types(client)).toEqual(["snapshot"]);
    expect(h.stored()?.watermark).toBe(2);
  });
  it("does not persist or broadcast a batch it must resync", async () => {
    const h = harness(), edge = h.make(), client = h.socket();
    expect(await edge.ingest(batch({ fromSequence: 5, watermark: 6 }))).toEqual({ accepted: false, resync: true });
    expect(client.sent).toEqual([]); expect(h.stored()).toBeUndefined();
  });
  it("greets a new client with a snapshot that includes BizPulse topology", async () => {
    const h = harness(), edge = h.make();
    await edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const client = h.socket(); await edge.hello(client, null);
    const hello = JSON.parse(client.sent.at(-1)!);
    expect(hello.type).toBe("snapshot"); expect(hello.topology[0].startupName).toBe("Bob");
  });
  it("still serves the stored state after a restart (no delta log, so a snapshot)", async () => {
    const h = harness();
    await h.make().ingest(batch({ kind: "snapshot", watermark: 3 }));
    const client = h.socket(); await h.make().hello(client, 1);
    expect(types(client)).toEqual(["snapshot"]);
  });
  it("keeps the last topology if BizPulse fails", async () => {
    let fail = false, t = 0;
    const h = harness(() => t, async () => { if (fail) throw new Error("down"); return [{ startupId: "s1", startupName: "Bob", repoSlug: "bob" }]; });
    const edge = h.make(); await edge.hello(h.socket(), null);
    fail = true; t = 400_000;
    const client = h.socket(); await edge.hello(client, null);
    expect(JSON.parse(client.sent[0]!).topology).toHaveLength(1);
  });

  it("resumes a client from its cursor when a refresh finds the same topology", async () => {
    let t = 0;
    const h = harness(() => t);
    const edge = h.make();
    await edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const first = h.socket(); await edge.hello(first, null);
    const cursor = last(first).seq;
    t = 400_000; // past the topology TTL; BizPulse answers with the same list
    const again = h.socket(); await edge.hello(again, cursor);
    expect(again.sent).toEqual([]);
  });
  it("pushes a changed topology to connected clients, and a client resuming from before it gets a snapshot", async () => {
    let t = 0, repos: TopologyRepo[] = [{ startupId: "s1", startupName: "Bob", repoSlug: "bob" }];
    const h = harness(() => t, async () => repos);
    const edge = h.make();
    await edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const watcher = h.socket(); await edge.hello(watcher, null);
    const cursor = last(watcher).seq;
    repos = [...repos, { startupId: "s2", startupName: "Pulse", repoSlug: "pulse" }]; t = 400_000;
    const late = h.socket(); await edge.hello(late, cursor);
    expect(last(watcher)).toMatchObject({ type: "snapshot", topology: [{ startupId: "s1" }, { startupId: "s2" }] });
    expect(last(watcher).seq).toBeGreaterThan(cursor);
    expect(types(late)).toEqual(["snapshot"]);
    expect(last(late).topology).toHaveLength(2);
    expect(h.stored()?.view.topology).toHaveLength(2);
  });
  it("does not lose a batch ingested while BizPulse is still answering", async () => {
    let release!: (repos: TopologyRepo[]) => void;
    const h = harness(() => 1_000, () => new Promise<TopologyRepo[]>((resolve) => { release = resolve; }));
    const edge = h.make();
    await edge.ingest(batch({ kind: "snapshot", watermark: 1 }));
    const greeting = edge.hello(h.socket(), null);
    await new Promise((r) => setTimeout(r, 0));
    expect(await edge.ingest(batch({ fromSequence: 1, watermark: 2, items: [{ itemId: "a", planId: "p", resourceVersion: 1, state: "ready", currentAttemptId: null, execution: null, achievedMilestones: [], operationIds: [], evidenceRefs: [] }] }))).toEqual({ accepted: true, watermark: 2 });
    release([{ startupId: "s1", startupName: "Bob", repoSlug: "bob" }]);
    await greeting;
    expect(h.stored()?.watermark).toBe(2);
    expect(h.stored()?.view.items.a).toBeDefined();
    expect(h.stored()?.view.topology).toHaveLength(1);
  });
  it("asks BizPulse once when several clients connect at the same time", async () => {
    let calls = 0;
    const h = harness(() => 1_000, async () => { calls++; return [{ startupId: "s1", startupName: "Bob", repoSlug: "bob" }]; });
    const edge = h.make();
    await Promise.all([edge.hello(h.socket(), null), edge.hello(h.socket(), null)]);
    expect(calls).toBe(1);
  });
  it("loads stored state once even when calls race on a cold start", async () => {
    let gets = 0;
    let stored: EdgeState | undefined;
    const storage = { get: async () => { gets++; return stored; }, put: async (s: EdgeState) => { stored = structuredClone(s); } };
    const edge = new EdgeController(storage, () => [], () => 1);
    await Promise.all([edge.ingest(batch({ kind: "snapshot", watermark: 1 })), edge.ingest(batch({ kind: "heartbeat", watermark: 0 }))]);
    expect(gets).toBe(1);
    expect(stored?.watermark).toBe(1);
  });
});
