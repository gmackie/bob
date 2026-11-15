// BOB-80 (BOB-75 Phase 3): the edge's attempt level — tail route, tail validation and
// fan-out, watches across hibernation, the unavailable marker, ResolveInput checks.
import { describe, expect, it, vi } from "vitest";
import { encodeAnswers, TAIL_LIMITS, type CiMessage, type ItemSnapshot, type PendingInput, type PlanSnapshot, type TailFrame } from "@bob/sdlc-view";
import { AttemptEdge, tailResponse } from "./attempt-edge";
import { EdgeController } from "./controller";
import { attachUser, greet, greetedSockets, handleCommand, parseCommandMessage, parseWatchMessage, readAttachment } from "./edge-sockets";
import { handleSdlcRoute, type SdlcRouteEnv } from "./routes";
import type { IngestBatch } from "./store";
import { MAX_TAIL_ITEMS, MAX_TAIL_BYTES, parseTailFrame, parseTailPost, TAIL_STALE_MS, TailHub } from "./tail";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

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
const rehydrate = (s: Socket) => { const copy = fakeSocket(); copy.serializeAttachment(s.deserializeAttachment()); return copy; };
const messages = (s: Socket) => s.sent.map((d) => JSON.parse(d) as Record<string, unknown>);

const target = { environmentId: "e", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const plan: PlanSnapshot = {
  planId: "p1", resourceVersion: 1, state: "active",
  definition: { items: [{ itemId: "i1", issue: { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: "x" }, target, completionTarget: "execution" }], dependencies: [], concurrencyLimit: 1 },
};
const pending: PendingInput = {
  attemptId: "a1", promptId: "r1", kind: "user_input", createdAt: "2026-11-15T00:00:00Z",
  questions: [
    { id: "q1", question: "Which?", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
    { id: "q2", question: "Any notes?", options: [], multiSelect: false },
  ],
};
const item = (state: ItemSnapshot["state"], extra: Partial<ItemSnapshot> = {}, itemId = "i1"): ItemSnapshot => ({
  itemId, planId: "p1", resourceVersion: 5, state, currentAttemptId: "a1",
  execution: { attemptId: "a1", target, thread: { environmentId: "e", projectId: "bob", threadId: "t1" } },
  achievedMilestones: [], operationIds: [], evidenceRefs: [], ...extra,
});
const frame = (itemId = "i1", lines = ["hello"], extra: Partial<TailFrame> = {}): TailFrame =>
  ({ itemId, attemptId: "a1", threadId: "t1", lines, threadStatus: "running", at: "2026-11-15T00:00:00Z", ...extra });

const VIEWERS = "u1, u2";
function harness(items: ItemSnapshot[] = [item("running")]) {
  let clock = 1_000_000;
  const all: Socket[] = [];
  const sql = nodeSqlitePort();
  const controller = new EdgeController({ sql, sockets: () => greetedSockets(all), now: () => clock, newEpoch: () => "e1" });
  const ingest = (b: Partial<IngestBatch> = {}) => controller.ingest({ contractVersion: "1", kind: "heartbeat", watermark: 0, plans: [], items: [], ...b });
  ingest({ kind: "snapshot", watermark: 1, plans: [plan], items });
  const ciMessage = vi.fn(async (i: ItemSnapshot): Promise<CiMessage> => ({ type: "ci", itemId: i.itemId, available: false, reason: "no commit yet", at: "t" }));
  const work: Promise<unknown>[] = [];
  let viewers = VIEWERS;
  const edge = new AttemptEdge({
    sockets: () => all,
    item: (id) => controller.store.item(id),
    plan: (id) => controller.store.plan(id),
    topology: () => controller.store.meta().topology,
    ci: { message: ciMessage },
    viewerIds: () => viewers,
    now: () => clock,
    schedule: (w) => { work.push(w); },
  });
  const connect = (userId: string | null, greeted = true) => {
    const s = fakeSocket();
    attachUser(s, userId);
    all.push(s);
    if (greeted) greet(controller, s, { cursor: null, epoch: null }, () => {});
    s.sent.length = 0;
    return s;
  };
  const watch = (s: Socket, itemId: string | null) => edge.watch(s, parseWatchMessage(JSON.stringify({ type: "watch", itemId }))!);
  return {
    all, controller, edge, connect, watch, ingest, ciMessage, sql,
    settle: () => Promise.all(work.splice(0)),
    setViewers: (v: string) => { viewers = v; },
    tick: (ms: number) => { clock += ms; },
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

const TOKEN = "k".repeat(40);
function namespace() {
  const calls: Array<{ path: string; body: string }> = [];
  return {
    calls,
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (input: RequestInfo, init?: RequestInit) => {
        const request = new Request(input, init);
        calls.push({ path: new URL(request.url).pathname, body: await request.text() });
        return Response.json({ accepted: 1 });
      },
    }),
  };
}
const routeEnv = () => ({ SDLC_EDGE: namespace(), SDLC_EDGE_WORKSPACE_ID: "w", SDLC_EDGE_INGEST_TOKEN: TOKEN, SDLC_VIEWER_USER_IDS: "u1" });
const postTail = (env: ReturnType<typeof routeEnv>, body: BodyInit, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  handleSdlcRoute(new Request("https://bob.test/api/sdlc/tail", { method: "POST", body, headers, duplex: "half" } as RequestInit), env as unknown as SdlcRouteEnv, async () => null);

describe("POST /api/sdlc/tail", () => {
  it("is 401 without the bearer or with the wrong one, and nothing reaches the DO", async () => {
    const env = routeEnv();
    const body = JSON.stringify({ frames: [frame()] });
    expect((await postTail(env, body, {})).status).toBe(401);
    expect((await postTail(env, body, { authorization: `Bearer ${"x".repeat(40)}` })).status).toBe(401);
    expect((await postTail(env, body, { authorization: TOKEN })).status).toBe(401);
    expect(env.SDLC_EDGE.calls).toEqual([]);
  });
  it("is 405 for anything but POST, after auth", async () => {
    const env = routeEnv();
    const res = await handleSdlcRoute(new Request("https://bob.test/api/sdlc/tail", { headers: { authorization: `Bearer ${TOKEN}` } }), env as unknown as SdlcRouteEnv, async () => null);
    expect(res.status).toBe(405);
  });
  it("is 413 over MAX_TAIL_BYTES, counted from the stream, not Content-Length", async () => {
    const env = routeEnv();
    const big = "x".repeat(MAX_TAIL_BYTES + 1);
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const res = await postTail(env, stream, { authorization: `Bearer ${TOKEN}`, "content-length": "10" });
    expect(res.status).toBe(413);
    expect(env.SDLC_EDGE.calls).toEqual([]);
  });
  it("forwards an authorized body to the DO's /tail", async () => {
    const env = routeEnv();
    const body = JSON.stringify({ frames: [frame()] });
    expect((await postTail(env, body)).status).toBe(200);
    expect(env.SDLC_EDGE.calls).toEqual([{ path: "/tail", body }]);
  });
  it("answers 503 when the edge is not configured", async () => {
    const res = await postTail({ ...routeEnv(), SDLC_EDGE_WORKSPACE_ID: "" }, "{}");
    expect(res.status).toBe(503);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("tail validation and clamping", () => {
  it("keeps the last maxLines lines, each cut to maxLineChars", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}:${"y".repeat(500)}`);
    const parsed = parseTailFrame(frame("i1", lines))!;
    expect(parsed.lines).toHaveLength(TAIL_LIMITS.maxLines);
    expect(parsed.lines[0]!.startsWith("60:")).toBe(true);
    expect(parsed.lines.every((l) => l.length <= TAIL_LIMITS.maxLineChars)).toBe(true);
  });
  it("drops unknown fields", () => {
    expect(parseTailFrame({ ...frame(), secret: "x" })).toEqual(frame());
  });
  it("refuses malformed frames and bodies", () => {
    for (const bad of [null, [], { ...frame(), itemId: "" }, { ...frame(), lines: "x" }, { ...frame(), lines: [1] }, { ...frame(), threadStatus: 3 }, { ...frame(), attemptId: "a".repeat(201) }]) {
      expect(parseTailFrame(bad)).toBeNull();
    }
    expect(parseTailPost({})).toBeNull();
    expect(parseTailPost({ frames: [frame(), { nope: true }] })).toBeNull();
    expect(parseTailPost([frame()])).toBeNull();
  });
  it("keeps at most maxFramesPerPost frames (the last ones) and the last frame per item", () => {
    const many = Array.from({ length: 70 }, (_, i) => frame(`i${i}`));
    const parsed = parseTailPost({ frames: many })!;
    expect(parsed).toHaveLength(TAIL_LIMITS.maxFramesPerPost);
    expect(parsed[0]!.itemId).toBe("i20");
    expect(parseTailPost({ frames: [frame("i1", ["old"]), frame("i2"), frame("i1", ["new"])] })!.map((f) => [f.itemId, f.lines[0]]))
      .toEqual([["i2", "hello"], ["i1", "new"]]);
  });
  it("tailResponse is 400 on bad JSON or shape, else the count relayed", async () => {
    const h = harness();
    expect(tailResponse(h.edge, "{").status).toBe(400);
    expect(tailResponse(h.edge, JSON.stringify({ frames: [{}] })).status).toBe(400);
    const ok = tailResponse(h.edge, JSON.stringify({ frames: [frame(), frame("i2")] }));
    expect(await ok.json()).toEqual({ accepted: 2 });
  });
  it("TailHub holds a bounded number of items, evicting the least recently updated", () => {
    const hub = new TailHub(3);
    for (const id of ["a", "b", "c"]) hub.put(frame(id), 0);
    hub.put(frame("a", ["again"]), 1);
    hub.put(frame("d"), 2);
    expect(hub.size).toBe(3);
    expect(hub.get("b")).toBeUndefined();
    expect(hub.get("a")!.frame.lines).toEqual(["again"]);
    expect(MAX_TAIL_ITEMS).toBeGreaterThan(0);
  });
});

// ─── Watch + fan-out ──────────────────────────────────────────────────────────

describe("watch and tail fan-out", () => {
  it("parses watch messages strictly", () => {
    expect(parseWatchMessage('{"type":"watch","itemId":"i1"}')).toEqual({ type: "watch", itemId: "i1" });
    expect(parseWatchMessage('{"type":"watch","itemId":null}')).toEqual({ type: "watch", itemId: null });
    for (const bad of ['{"type":"watch"}', '{"type":"watch","itemId":""}', '{"type":"watch","itemId":3}', '{"type":"hello"}', "nope", JSON.stringify({ type: "watch", itemId: "x".repeat(600) })]) {
      expect(parseWatchMessage(bad)).toBeNull();
    }
    expect(parseWatchMessage(new ArrayBuffer(4))).toBeNull();
  });
  it("sends a frame only to sockets watching that item", () => {
    const h = harness([item("running"), item("running", {}, "i2")]);
    const w1 = h.connect("u1"), w2 = h.connect("u2"), other = h.connect("u1"), idle = h.connect("u2");
    h.watch(w1, "i1"); h.watch(w2, "i1"); h.watch(other, "i2");
    for (const s of [w1, w2, other, idle]) s.sent.length = 0;
    h.edge.ingestTail([frame("i1", ["a"])]);
    expect(messages(w1)).toEqual([{ type: "tail", frame: frame("i1", ["a"]) }]);
    expect(messages(w2)).toEqual([{ type: "tail", frame: frame("i1", ["a"]) }]);
    expect(other.sent).toEqual([]);
    expect(idle.sent).toEqual([]);
  });
  it("refuses a watch from an ungreeted socket, a socket with no user, or a user off the allow-list", () => {
    const h = harness();
    const ungreeted = h.connect("u1", false), anon = h.connect(null), stranger = h.connect("u9");
    for (const s of [ungreeted, anon, stranger]) expect(h.watch(s, "i1")).toBe(false);
    h.edge.ingestTail([frame()]);
    for (const s of [ungreeted, anon, stranger]) expect(s.sent).toEqual([]);
    expect(readAttachment(stranger).watch).toBeUndefined();
  });
  it("re-checks the allow-list on fan-out", () => {
    const h = harness();
    const s = h.connect("u2");
    h.watch(s, "i1"); s.sent.length = 0;
    h.setViewers("u1");
    h.edge.ingestTail([frame()]);
    expect(s.sent).toEqual([]);
  });
  it("one watched item per socket: a new watch replaces it, null stops it", () => {
    const h = harness([item("running"), item("running", {}, "i2")]);
    const s = h.connect("u1");
    h.watch(s, "i1"); h.watch(s, "i2"); s.sent.length = 0;
    h.edge.ingestTail([frame("i1"), frame("i2")]);
    expect(messages(s).map((m) => (m.frame as TailFrame).itemId)).toEqual(["i2"]);
    h.watch(s, null); s.sent.length = 0;
    h.edge.ingestTail([frame("i2")]);
    expect(s.sent).toEqual([]);
    expect(readAttachment(s)).toEqual({ userId: "u1", greeted: true });
  });
  it("replays the latest frame to a new watcher, and nothing reaches storage", () => {
    const h = harness();
    const before = h.sql.statements.length;
    h.edge.ingestTail([frame("i1", ["one"])]);
    h.edge.ingestTail([frame("i1", ["two"])]);
    expect(h.sql.statements.length).toBe(before);
    const s = h.connect("u1");
    h.watch(s, "i1");
    expect(messages(s)[0]).toEqual({ type: "tail", frame: frame("i1", ["two"]) });
    expect(h.sql.statements.slice(before).some((q) => /INSERT|UPDATE|DELETE/i.test(q))).toBe(false);
  });
  it("the watch survives a hibernation round-trip of the attachment", () => {
    const h = harness();
    const s = h.connect("u1");
    h.watch(s, "i1");
    const woken = rehydrate(s);
    h.all.splice(h.all.indexOf(s), 1, woken);
    expect(readAttachment(woken)).toMatchObject({ greeted: true, userId: "u1", watch: "i1" });
    h.edge.ingestTail([frame()]);
    expect(messages(woken)).toEqual([{ type: "tail", frame: frame() }]);
    // A later hello keeps the watch.
    greet(h.controller, woken, { cursor: null, epoch: null }, () => {});
    expect(readAttachment(woken).watch).toBe("i1");
  });
});

describe("tailUnavailable on watch", () => {
  it("is sent for a running item with no frame yet", () => {
    const h = harness();
    const s = h.connect("u1");
    h.watch(s, "i1");
    expect(messages(s)).toEqual([{ type: "tailUnavailable", itemId: "i1", reason: expect.any(String) }]);
  });
  it("is sent for a waiting-input item whose last frame is older than TAIL_STALE_MS, after the stale frame", () => {
    const h = harness([item("waiting-input", { pendingInput: pending })]);
    h.edge.ingestTail([frame()]);
    h.tick(TAIL_STALE_MS + 1);
    const s = h.connect("u1");
    h.watch(s, "i1");
    expect(messages(s).map((m) => m.type)).toEqual(["tail", "tailUnavailable"]);
  });
  it("is not sent for a fresh frame, or for an item that is not running", () => {
    const h = harness([item("running"), item("completed", {}, "i2")]);
    h.edge.ingestTail([frame()]);
    h.tick(TAIL_STALE_MS - 1);
    const a = h.connect("u1"), b = h.connect("u1"), c = h.connect("u1");
    h.watch(a, "i1"); h.watch(b, "i2"); h.watch(c, "unknown");
    expect(messages(a).map((m) => m.type)).toEqual(["tail"]);
    expect(b.sent).toEqual([]);
    expect(c.sent).toEqual([]);
  });
});

describe("CI detail through the attempt edge", () => {
  it("sends CI to the watching socket after a watch, and polls only watched items", async () => {
    const h = harness([item("running"), item("running", {}, "i2")]);
    const s = h.connect("u1"), t = h.connect("u2");
    h.watch(s, "i1");
    await h.settle();
    expect(messages(s).filter((m) => m.type === "ci")).toEqual([{ type: "ci", itemId: "i1", available: false, reason: "no commit yet", at: "t" }]);
    s.sent.length = 0;
    expect(await h.edge.pollCi()).toBe(true);
    expect(h.ciMessage).toHaveBeenCalledTimes(2);
    expect(messages(s).map((m) => m.type)).toEqual(["ci"]);
    expect(t.sent).toEqual([]);
    h.watch(s, null);
    h.ciMessage.mockClear();
    expect(await h.edge.pollCi()).toBe(false);
    expect(h.ciMessage).not.toHaveBeenCalled();
  });
  it("drops a CI reply for a watch that moved on before it arrived", async () => {
    const h = harness([item("running"), item("running", {}, "i2")]);
    const s = h.connect("u1");
    h.watch(s, "i1");
    h.watch(s, "i2");
    s.sent.length = 0;
    await h.settle();
    expect(messages(s).filter((m) => m.type === "ci").map((m) => m.itemId)).toEqual(["i2"]);
  });
});

// ─── ResolveInput ─────────────────────────────────────────────────────────────

describe("ResolveInput relay checks", () => {
  const answer = encodeAnswers({ q1: "A", q2: "SECRET-ANSWER-TEXT" });
  const resolve = (commandId: string, over: Record<string, unknown> = {}) =>
    ({ type: "command", commandId, operation: "ResolveInput", input: { itemId: "i1", attemptId: "a1", promptId: "r1", answer, ...over } });
  function setup(items: ItemSnapshot[]) {
    const h = harness(items);
    const s = h.connect("u1");
    const send = (message: unknown) => {
      handleCommand(h.controller, s, parseCommandMessage(JSON.stringify(message)), VIEWERS, 1_000_000);
      return JSON.parse(s.sent.at(-1)!) as Record<string, unknown>;
    };
    return { ...h, s, send };
  }

  it("accepts a valid answer at tier 1 (no confirmation) and queues it", () => {
    const h = setup([item("waiting-input", { pendingInput: pending })]);
    expect(h.send(resolve("c1"))).toEqual({ type: "commandAccepted", commandId: "c1" });
    expect(h.controller.outbox.isQueued("c1")).toBe(true);
  });
  it.each([
    ["an unknown item", [item("waiting-input", { pendingInput: pending })], { itemId: "nope" }, /Unknown item/],
    ["an item not waiting for input", [item("running")], {}, /not waiting/],
    ["an item with no pending prompt", [item("waiting-input")], {}, /no pending prompt/],
    ["a stale attempt", [item("waiting-input", { pendingInput: pending })], { attemptId: "a0" }, /no longer pending/],
    ["a stale prompt", [item("waiting-input", { pendingInput: pending })], { promptId: "r0" }, /no longer pending/],
    ["an answer that is not JSON", [item("waiting-input", { pendingInput: pending })], { answer: "SECRET-ANSWER-TEXT" }, /does not match/],
    ["an answer missing a question", [item("waiting-input", { pendingInput: pending })], { answer: encodeAnswers({ q1: "A" }) }, /does not match/],
    ["an answer to an unknown question", [item("waiting-input", { pendingInput: pending })], { answer: encodeAnswers({ q1: "A", q2: "x", q3: "y" }) }, /does not match/],
    ["several answers to a single-select question", [item("waiting-input", { pendingInput: pending })], { answer: encodeAnswers({ q1: ["A", "B"], q2: "x" }) }, /does not match/],
  ])("rejects %s as invalid, without quoting the answer", (_label, items, over, message) => {
    const h = setup(items);
    const reply = h.send(resolve("c1", over));
    expect(reply).toMatchObject({ type: "commandRejected", commandId: "c1", code: "invalid", message: expect.stringMatching(message) });
    expect(JSON.stringify(reply)).not.toContain("SECRET-ANSWER-TEXT");
    expect(h.controller.outbox.isQueued("c1")).toBe(false);
  });
  it("replays an accepted commandId after the prompt is resolved instead of rejecting it", () => {
    const h = setup([item("waiting-input", { pendingInput: pending })]);
    h.send(resolve("c1"));
    h.ingest({ kind: "changes", fromSequence: 1, watermark: 2, items: [item("running", { resourceVersion: 6 })] });
    expect(h.send(resolve("c1"))).toEqual({ type: "commandAccepted", commandId: "c1" });
  });
  it("never logs the answer", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const h = setup([item("waiting-input", { pendingInput: pending })]);
      h.send(resolve("c1"));
      h.send(resolve("c2", { promptId: "r0" }));
      const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
      expect(logged).not.toContain("SECRET-ANSWER-TEXT");
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
  it("a long answer (16000 chars, JSON-escaped twice) still fits a command message", () => {
    const long = { ...pending, questions: [{ id: "q1", question: "Notes?", options: [], multiSelect: false }] };
    const h = setup([item("waiting-input", { pendingInput: long })]);
    const text = '"'.repeat(3_990);
    const big = encodeAnswers({ q1: text });
    expect(big.length).toBeLessThanOrEqual(16_000);
    expect(h.send(resolve("c1", { answer: big }))).toEqual({ type: "commandAccepted", commandId: "c1" });
  });
});
