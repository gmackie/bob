// BOB-79 Task 2.3: the SdlcEdge command outbox, through the controller and the socket
// helpers the DO wires up, over node:sqlite and fake hibernatable sockets.
import { describe, expect, it } from "vitest";
import { COMMAND_LIMITS, OFFLINE_AFTER_MS, type CommandResult, type ItemSnapshot, type PlanSnapshot } from "@bob/sdlc-view";
import { EdgeController, FAST_POLL_MS, type EdgeControllerOptions } from "./controller";
import { attachUser, greet, greetedSockets, handleCommand, parseCommandMessage, readAttachment } from "./edge-sockets";
import { MAX_COMMANDS_PER_RESPONSE, REDELIVER_AFTER_MS, RESULT_RETENTION_MS } from "./outbox";
import { parseBatch, type IngestBatch } from "./store";
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

const VIEWERS = "u1, u2";
function harness(options: Partial<EdgeControllerOptions> = {}) {
  const sql = nodeSqlitePort();
  let clock = 1_000_000;
  const all: Socket[] = [];
  const controller = new EdgeController({ sql, sockets: () => greetedSockets(all), connected: () => all.length, now: () => clock, newEpoch: () => "e1", ...options });
  const log = () => {};
  /** A socket as the DO accepts it (user id attached), greeted unless told otherwise. */
  const connect = (userId: string | null, greeted = true) => {
    const s = fakeSocket();
    attachUser(s, userId);
    all.push(s);
    if (greeted) { greet(controller, s, { cursor: null, epoch: null }, log); s.sent.length = 0; }
    return s;
  };
  const send = (s: Socket, message: unknown, viewers = VIEWERS) => {
    const raw = parseCommandMessage(JSON.stringify(message));
    handleCommand(controller, s, raw, viewers, clock);
    return JSON.parse(s.sent.at(-1)!) as Record<string, unknown>;
  };
  const ingest = (b: Partial<IngestBatch> = {}) =>
    controller.ingest({ contractVersion: "1", kind: "heartbeat", watermark: 0, plans: [], items: [], ...b });
  return { sql, controller, all, connect, send, ingest, tick: (ms: number) => { clock += ms; }, get clock() { return clock; } };
}

let n = 0;
const pause = (commandId = `c${++n}`, extra: Record<string, unknown> = {}) =>
  ({ type: "command", commandId, operation: "ControlPlan", input: { planId: "p1", expectedVersion: 3, action: "pause" }, ...extra });
const cancelItem = (commandId: string, confirm?: unknown) =>
  ({ type: "command", commandId, operation: "CancelItem", input: { itemId: "i1", expectedVersion: 2 }, ...(confirm ? { confirm } : {}) });
const ok = (commandId: string): CommandResult =>
  ({ commandId, ok: true, operation: { contractVersion: "1", operationId: `op-${commandId}`, commandId, state: "succeeded", resourceId: "p1", resourceVersion: 4 } });
const messages = (s: Socket) => s.sent.map((d) => JSON.parse(d) as Record<string, unknown>);
const rows = (h: ReturnType<typeof harness>) => h.sql.exec<{ command_id: string }>("SELECT command_id FROM command_outbox ORDER BY rowid").map((r) => r.command_id);

describe("who may send commands", () => {
  it("rejects a socket without a user id, and a user off the allow-list, as forbidden", () => {
    const h = harness(); h.ingest();
    expect(h.send(h.connect(null), pause("a"))).toEqual({ type: "commandRejected", commandId: "a", code: "forbidden", message: expect.any(String) });
    expect(h.send(h.connect("u9"), pause("b"))).toMatchObject({ type: "commandRejected", code: "forbidden" });
    expect(rows(h)).toEqual([]);
  });
  it("re-checks the allow-list on every command", () => {
    const h = harness(); h.ingest();
    const s = h.connect("u2");
    expect(h.send(s, pause("a"))).toMatchObject({ type: "commandAccepted" });
    expect(h.send(s, pause("b"), "u1")).toMatchObject({ type: "commandRejected", code: "forbidden" });
    expect(h.send(s, pause("c"), "")).toMatchObject({ code: "forbidden" });
  });
  it("takes the user id from the attachment, never from the message, and keeps it across hello and hibernation", () => {
    const h = harness(); h.ingest();
    const s = h.connect("u1");
    expect(readAttachment(rehydrate(s))).toMatchObject({ greeted: true, userId: "u1" });
    const anon = h.connect(null);
    expect(h.send(anon, { ...pause("x"), userId: "u1", actor: "u1" })).toMatchObject({ code: "forbidden" });
    h.send(rehydrate(s), pause("y"));
    expect(h.ingest().commands).toEqual([expect.objectContaining({ commandId: "y", actor: "u1" })]);
  });
  it("answers a malformed command as invalid, echoing its commandId when it has one", () => {
    const h = harness(); h.ingest();
    const s = h.connect("u1");
    expect(h.send(s, { type: "command", commandId: "z", operation: "DeletePlan", input: {} })).toMatchObject({ type: "commandRejected", commandId: "z", code: "invalid" });
    expect(h.send(s, { type: "command", operation: "ReconcileItem", input: { itemId: "i" } })).toMatchObject({ commandId: "", code: "invalid" });
  });
  it("ignores socket messages that are not commands", () => {
    expect(parseCommandMessage("not json")).toBeNull();
    expect(parseCommandMessage(JSON.stringify({ type: "hello" }))).toBeNull();
    expect(parseCommandMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseCommandMessage(JSON.stringify(pause("a", { pad: "x".repeat(9000) })))).toBeNull();
  });
});

describe("checks before queueing", () => {
  it("refuses while the coordinator is offline: never heard from, or silent past the banner's window", () => {
    const h = harness();
    const s = h.connect("u1");
    expect(h.send(s, pause("a"))).toMatchObject({ code: "coordinator-offline" });
    h.ingest();
    h.tick(OFFLINE_AFTER_MS);
    expect(h.send(s, pause("b"))).toMatchObject({ type: "commandAccepted" });
    h.tick(1);
    expect(h.send(s, pause("c"))).toMatchObject({ code: "coordinator-offline" });
    expect(rows(h)).toEqual(["b"]);
  });
  it("needs a confirmation for tier 2", () => {
    const h = harness(); h.ingest();
    const s = h.connect("u1");
    expect(h.send(s, cancelItem("a"))).toMatchObject({ code: "confirmation-required" });
    expect(h.send(s, cancelItem("b", { confirmed: false }))).toMatchObject({ code: "confirmation-required" });
    expect(h.send(s, cancelItem("c", { confirmed: true }))).toMatchObject({ type: "commandAccepted", commandId: "c" });
    expect(rows(h)).toEqual(["c"]);
  });
  it("tier 3 must type the plan id, or the item's repository", () => {
    const h = harness({ tierOf: () => 3 });
    const target = { environmentId: "env", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "gmackie-bob" } };
    const issue = { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: "x" };
    const plan: PlanSnapshot = { planId: "p1", resourceVersion: 1, state: "active", definition: { items: [{ itemId: "i1", issue, target, completionTarget: "production" }, { itemId: "i2", issue, target: { ...target, repository: { integrationId: "forgegraph", repositoryId: "other" } }, completionTarget: "production" }], dependencies: [], concurrencyLimit: 1 } };
    const item = (itemId: string, execution: ItemSnapshot["execution"] = null): ItemSnapshot =>
      ({ itemId, planId: "p1", resourceVersion: 2, state: "running", currentAttemptId: null, execution, achievedMilestones: [], operationIds: [], evidenceRefs: [] });
    h.ingest({ kind: "snapshot", watermark: 1, plans: [plan], items: [item("i1", { attemptId: "a", target, thread: { environmentId: "env", projectId: "bob", threadId: "t" } }), item("i2")] });
    const s = h.connect("u1");
    expect(h.send(s, pause("a", { confirm: { confirmed: true } }))).toMatchObject({ code: "confirmation-required" });
    expect(h.send(s, pause("b", { confirm: { confirmed: true, typed: "P1" } }))).toMatchObject({ code: "confirmation-required" });
    expect(h.send(s, pause("c", { confirm: { confirmed: true, typed: "p1" } }))).toMatchObject({ type: "commandAccepted" });
    expect(h.send(s, cancelItem("d", { confirmed: true, typed: "gmackie-bob" }))).toMatchObject({ type: "commandAccepted" }); // from execution
    const i2 = { type: "command", operation: "CancelItem", input: { itemId: "i2", expectedVersion: 2 } };
    expect(h.send(s, { ...i2, commandId: "e", confirm: { confirmed: true, typed: "gmackie-bob" } })).toMatchObject({ code: "confirmation-required" });
    expect(h.send(s, { ...i2, commandId: "f", confirm: { confirmed: true, typed: "other" } })).toMatchObject({ type: "commandAccepted" }); // from the plan definition
    const unknown = { type: "command", operation: "ReconcileItem", input: { itemId: "nope" } };
    expect(h.send(s, { ...unknown, commandId: "g", confirm: { confirmed: true, typed: "" } })).toMatchObject({ code: "confirmation-required" });
  });
  it("limits each socket to maxPerSocketPerMinute, and the count survives hibernation", () => {
    const h = harness(); h.ingest();
    let s = h.connect("u1");
    for (let i = 0; i < COMMAND_LIMITS.maxPerSocketPerMinute; i++) {
      if (i === 10) s = rehydrate(s);
      expect(h.send(s, pause(`r${i}`))).toMatchObject({ type: "commandAccepted" });
    }
    expect(h.send(s, pause("over"))).toMatchObject({ type: "commandRejected", code: "rate-limited" });
    expect(h.send(h.connect("u1"), pause("other-socket"))).toMatchObject({ type: "commandAccepted" });
    h.tick(60_000);
    h.ingest();
    expect(h.send(s, pause("later"))).toMatchObject({ type: "commandAccepted" });
  });
  it("refuses once maxQueued commands are waiting", () => {
    const h = harness(); h.ingest();
    for (let i = 0; i < COMMAND_LIMITS.maxQueued; i++) h.controller.command(fakeSocket(), pause(`q${i}`), { userId: "u1", viewer: true, take: () => true });
    expect(h.send(h.connect("u1"), pause("one-more"))).toMatchObject({ code: "outbox-full" });
    expect(h.controller.outbox.size()).toBe(COMMAND_LIMITS.maxQueued);
  });
});

describe("the outbox", () => {
  it("hands an accepted command to the exporter once per pending period, until its result arrives", () => {
    const h = harness(); h.ingest();
    const s = h.connect("u1");
    h.send(s, pause("a"));
    const first = h.ingest();
    expect(first.commands).toEqual([{ commandId: "a", actor: "u1", queuedAt: h.clock, operation: "ControlPlan", input: { planId: "p1", expectedVersion: 3, action: "pause" } }]);
    h.tick(REDELIVER_AFTER_MS - 1);
    expect(h.ingest().commands).toEqual([]);
    h.tick(1);
    expect(h.ingest().commands.map((c) => c.commandId)).toEqual(["a"]); // no result yet: sent again
    h.ingest({ results: [ok("a")] });
    h.tick(REDELIVER_AFTER_MS);
    expect(h.ingest().commands).toEqual([]);
    expect(rows(h)).toEqual([]);
  });
  it("does not queue a re-sent commandId twice; once answered, a re-send gets the result", () => {
    const h = harness(); h.ingest();
    const s = h.connect("u1");
    h.send(s, pause("a"));
    expect(h.send(s, pause("a"))).toEqual({ type: "commandAccepted", commandId: "a" });
    expect(rows(h)).toEqual(["a"]);
    h.ingest({ results: [ok("a")] });
    h.tick(OFFLINE_AFTER_MS + 1); // even with the coordinator offline
    expect(h.send(s, pause("a"))).toEqual({ type: "commandResult", ...ok("a") });
    expect(rows(h)).toEqual([]);
  });
  it("broadcasts a result to every greeted socket, and ignores results for unknown commands", () => {
    const h = harness(); h.ingest();
    const sender = h.connect("u1"), watcher = h.connect("u2"), lurker = h.connect("u1", false);
    h.send(sender, pause("a"));
    for (const s of [sender, watcher, lurker]) s.sent.length = 0;
    h.ingest({ results: [ok("a"), ok("unknown")] });
    const results = (s: Socket) => messages(s).filter((m) => m.type === "commandResult");
    expect(results(sender)).toEqual([{ type: "commandResult", ...ok("a") }]);
    expect(results(watcher)).toEqual([{ type: "commandResult", ...ok("a") }]);
    expect(lurker.sent).toEqual([]);
    h.ingest({ results: [ok("a")] }); // a replayed result: already answered, not broadcast again
    expect(results(watcher)).toHaveLength(1);
  });
  it("expires commands the coordinator has not answered in time, and a late real result still replaces the expiry", () => {
    const h = harness(); h.ingest();
    const watcher = h.connect("u1");
    h.send(watcher, pause("a"));
    h.tick(COMMAND_LIMITS.expireAfterMs);
    watcher.sent.length = 0;
    const response = h.ingest();
    expect(response.commands).toEqual([]);
    const expired = { type: "commandResult", commandId: "a", ok: false, error: { code: "expired", message: expect.any(String), retryable: true } };
    expect(messages(watcher)).toContainEqual(expired);
    expect(h.send(watcher, pause("a"))).toEqual(expired);
    h.ingest({ results: [ok("a")] });
    expect(messages(watcher).at(-1)).toEqual({ type: "commandResult", ...ok("a") });
    h.ingest({ results: [{ commandId: "a", ok: false, error: { code: "x", message: "m", retryable: false } }] }); // answered for real: ignored
    expect(h.controller.outbox.result("a")).toEqual(ok("a"));
  });
  it("keeps results for about an hour", () => {
    const h = harness(); h.ingest();
    h.send(h.connect("u1"), pause("a"));
    h.ingest({ results: [ok("a")] });
    h.tick(RESULT_RETENTION_MS);
    h.ingest();
    expect(h.controller.outbox.result("a")).toEqual(ok("a"));
    h.tick(1);
    h.ingest();
    expect(h.controller.outbox.result("a")).toBeUndefined();
  });
  it("carries at most MAX_COMMANDS_PER_RESPONSE, oldest first", () => {
    const h = harness(); h.ingest();
    for (let i = 0; i < 25; i++) { h.controller.command(fakeSocket(), pause(`k${i}`), { userId: "u1", viewer: true, take: () => true }); h.tick(1); }
    expect(h.ingest().commands.map((c) => c.commandId)).toEqual(Array.from({ length: MAX_COMMANDS_PER_RESPONSE }, (_, i) => `k${i}`));
    expect(h.ingest().commands.map((c) => c.commandId)).toEqual(["k20", "k21", "k22", "k23", "k24"]);
  });
  it("carries commands on a resync response too, and applies its results", () => {
    const h = harness(); h.ingest();
    h.send(h.connect("u1"), pause("a"));
    h.send(h.connect("u2"), pause("b"));
    const response = h.ingest({ kind: "changes", fromSequence: 5, watermark: 6, results: [] });
    expect(response).toMatchObject({ accepted: false, resync: true });
    expect(response.commands.map((c) => c.commandId)).toEqual(["a", "b"]);
    h.ingest({ kind: "changes", fromSequence: 5, watermark: 6, results: [ok("a")] });
    expect(rows(h)).toEqual(["b"]);
  });
});

describe("pollMs", () => {
  it("is set while commands are queued or any socket is open, and absent otherwise", () => {
    const h = harness(); h.ingest();
    expect(h.ingest().pollMs).toBeUndefined();
    h.controller.command(fakeSocket(), pause("a"), { userId: "u1", viewer: true, take: () => true });
    expect(h.ingest().pollMs).toBe(FAST_POLL_MS); // queued, nobody watching
    h.ingest({ results: [ok("a")] });
    expect(h.ingest().pollMs).toBeUndefined();
    h.connect("u1", false); // open but not greeted still counts
    expect(h.ingest().pollMs).toBe(FAST_POLL_MS);
  });
});

describe("ingest results validation", () => {
  const base = { contractVersion: "1", kind: "heartbeat", watermark: 0, plans: [], items: [] };
  it("accepts a batch of any kind with well-formed results, keeping only known fields", () => {
    const parsed = parseBatch({ ...base, results: [{ ...ok("a"), extra: true }] });
    expect(parsed?.results).toEqual([ok("a")]);
    expect(parseBatch(base)?.results).toBeUndefined();
  });
  it("refuses the whole batch when results is not an array of results", () => {
    for (const results of [{}, "x", [null], [{ commandId: "a", ok: true }], [{ commandId: "a", ok: false, error: { code: "c" } }], Array.from({ length: 501 }, () => ok("a"))]) {
      expect(parseBatch({ ...base, results })).toBeNull();
    }
  });
});
