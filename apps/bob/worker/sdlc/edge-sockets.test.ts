import { describe, expect, it } from "vitest";
import { EdgeController } from "./controller";
import { greet, greetedSockets, ingestResponse, MAX_HELLO_CHARS, parseHello, type AttachedSocket } from "./edge-sockets";
import type { IngestBatch } from "./store";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

/** A hibernatable socket as the DO sees it: an attachment that survives hibernation, and send. */
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
/** What getWebSockets() hands back after hibernation: new objects over the same attachments. */
const rehydrate = (s: ReturnType<typeof fakeSocket>) => {
  const copy = fakeSocket();
  copy.serializeAttachment(s.deserializeAttachment());
  return copy;
};

function harness() {
  const all: Array<ReturnType<typeof fakeSocket>> = [];
  const logs: unknown[] = [];
  const controller = new EdgeController({ sql: nodeSqlitePort(), sockets: () => greetedSockets(all), now: () => 1_000, newEpoch: () => "epoch-1" });
  const connect = () => { const s = fakeSocket(); all.push(s); return s; };
  return { all, logs, controller, connect, log: (line: string) => logs.push(JSON.parse(line)) };
}
const batch = (b: Partial<IngestBatch>): IngestBatch => ({ contractVersion: "1", kind: "snapshot", watermark: 1, plans: [], items: [], ...b });
const types = (s: { sent: string[] }) => s.sent.map((d) => (JSON.parse(d) as { type: string }).type);

describe("greetedSockets", () => {
  it("keeps only sockets marked greeted, and the mark survives hibernation", () => {
    const greeted = fakeSocket(), silent = fakeSocket(), junk = fakeSocket();
    greeted.serializeAttachment({ greeted: true });
    junk.serializeAttachment({ greeted: "yes" });
    expect(greetedSockets([greeted, silent, junk])).toEqual([greeted]);
    const woken = rehydrate(greeted);
    expect(greetedSockets([woken, rehydrate(silent)])).toEqual([woken]);
  });
  it("skips a socket whose attachment cannot be read", () => {
    const broken = { ...fakeSocket(), deserializeAttachment: () => { throw new Error("gone"); } } as AttachedSocket;
    expect(greetedSockets([broken])).toEqual([]);
  });
});

describe("broadcasts reach greeted sockets only", () => {
  it("does not send a broadcast to a socket that has not said hello", () => {
    const h = harness();
    const viewer = h.connect(), lurker = h.connect();
    greet(h.controller, viewer, { cursor: null, epoch: null }, h.log);
    viewer.sent.length = 0;
    expect(h.controller.ingest(batch({ watermark: 2 }))).toMatchObject({ accepted: true, watermark: 2 });
    expect(types(viewer)).toEqual(["snapshot"]);
    expect(lurker.sent).toEqual([]);
    // Once it says hello it gets its own reply, then later broadcasts.
    greet(h.controller, lurker, { cursor: null, epoch: null }, h.log);
    expect(types(lurker)).toEqual(["snapshot", "status"]);
    h.controller.ingest(batch({ kind: "heartbeat", watermark: 2 }));
    expect(types(lurker)).toEqual(["snapshot", "status", "status"]);
  });
});

describe("greet", () => {
  it("marks the socket greeted before replying, then logs the size of what it sent without contents", () => {
    const h = harness();
    const socket = h.connect();
    const greetedWhenSent: boolean[] = [];
    const send = socket.send;
    socket.send = (data: string) => { greetedWhenSent.push(greetedSockets([socket]).length === 1); send(data); };
    greet(h.controller, socket, { cursor: null, epoch: null }, h.log);
    expect(greetedWhenSent).toEqual([true, true]);
    expect(socket.deserializeAttachment()).toEqual({ greeted: true });
    const bytes = socket.sent.reduce((n, d) => n + new TextEncoder().encode(d).byteLength, 0);
    expect(h.logs).toEqual([{ event: "sdlc_edge_hello", reply: "snapshot", messages: 2, bytes, largestBytes: new TextEncoder().encode(socket.sent[0]!).byteLength }]);
  });
  it("reports a delta resume as such", () => {
    const h = harness();
    const socket = h.connect();
    h.controller.ingest(batch({ watermark: 2 }));
    const { epoch, seq } = h.controller.store.meta();
    greet(h.controller, socket, { cursor: seq, epoch }, h.log);
    expect(h.logs).toEqual([expect.objectContaining({ event: "sdlc_edge_hello", reply: "deltas", messages: 1 })]);
  });
});

describe("parseHello", () => {
  it("accepts a hello with a cursor and epoch, or nulls", () => {
    expect(parseHello(JSON.stringify({ type: "hello", cursor: 4, epoch: "e" }))).toEqual({ cursor: 4, epoch: "e" });
    expect(parseHello(JSON.stringify({ type: "hello", cursor: null, epoch: null }))).toEqual({ cursor: null, epoch: null });
    expect(parseHello(JSON.stringify({ type: "hello", cursor: 0, epoch: null }))).toEqual({ cursor: 0, epoch: null });
  });
  it("ignores binary, oversized, malformed and other messages", () => {
    const ok = JSON.stringify({ type: "hello", cursor: 1, epoch: "e" });
    expect(parseHello(new TextEncoder().encode(ok).buffer as ArrayBuffer)).toBeNull();
    expect(parseHello(JSON.stringify({ type: "hello", cursor: 1, epoch: "e".repeat(MAX_HELLO_CHARS) }))).toBeNull();
    expect(parseHello(JSON.stringify({ type: "hello", cursor: 1, epoch: "e".repeat(MAX_HELLO_CHARS - 40) }))).not.toBeNull();
    for (const bad of [
      "not json", "null", "[]", "{}",
      { type: "ping" },
      { type: "hello" },
      { type: "hello", cursor: 1 },
      { type: "hello", cursor: "1", epoch: "e" },
      { type: "hello", cursor: -1, epoch: "e" },
      { type: "hello", cursor: 1.5, epoch: "e" },
      { type: "hello", cursor: 1, epoch: 3 },
    ]) expect(parseHello(typeof bad === "string" ? bad : JSON.stringify(bad))).toBeNull();
  });
});

describe("ingestResponse", () => {
  const controller = () => new EdgeController({ sql: nodeSqlitePort(), sockets: () => [], now: () => 1_000, newEpoch: () => "e" });
  it("answers 400 to a body that is not JSON or not a valid batch", async () => {
    const c = controller();
    expect(ingestResponse(c, "not json").status).toBe(400);
    expect(ingestResponse(c, JSON.stringify({ kind: "snapshot" })).status).toBe(400);
    expect(c.store.meta().watermark).toBe(0);
  });
  it("answers 200 with the ingest result", async () => {
    const c = controller();
    const res = ingestResponse(c, JSON.stringify(batch({ watermark: 5 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, watermark: 5, commands: [] });
  });
  it("answers 503 with a generic body when storage fails, so the exporter retries", async () => {
    const sql = nodeSqlitePort();
    const c = new EdgeController({ sql, sockets: () => [], now: () => 1_000, newEpoch: () => "e" });
    sql.failNext(/INSERT INTO meta/);
    const errors: unknown[] = [];
    const res = ingestResponse(c, JSON.stringify(batch({ watermark: 5 })), (line) => errors.push(JSON.parse(line)));
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ error: "unavailable" }));
    expect(body).not.toMatch(/INSERT|meta|storage/);
    // The log keeps the cause for operators; the response does not.
    expect(errors).toEqual([{ event: "sdlc_edge_ingest_failed", kind: "snapshot", error: expect.stringContaining("injected storage failure") }]);
    expect(ingestResponse(c, JSON.stringify(batch({ watermark: 5 }))).status).toBe(200);
  });
});
