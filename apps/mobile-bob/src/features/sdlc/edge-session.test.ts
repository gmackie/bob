import type { ItemSnapshot } from "@bob/sdlc-view";
import { describe, expect, it } from "vitest";

import { asAttemptMessage, createSession, reconnectDelay } from "./edge-session";
import type {SocketHandlers} from "./edge-session";
import { item, must, plan, TOPOLOGY } from "./test-fixtures";

function harness() {
  const sockets: { handlers: SocketHandlers; sent: unknown[]; closed: boolean }[] = [];
  const timers: (() => void)[] = [];
  let id = 0;
  const session = createSession({
    open: (handlers) => {
      const s = { handlers, sent: [] as unknown[], closed: false };
      sockets.push(s);
      return { send: (d) => s.sent.push(JSON.parse(d)), close: () => { s.closed = true; } };
    },
    newId: () => `cmd-${++id}`,
    random: () => 0.5,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => undefined,
  });
  const last = () => must(sockets.at(-1), "socket");
  const deliver = (m: unknown) => last().handlers.onMessage(JSON.stringify(m));
  return { session, sockets, timers, last, deliver };
}

const snapshot = (seq = 1, items: ItemSnapshot[] = [item("p1", { itemId: "i1", state: "running" })]) => ({
  type: "snapshot", epoch: "e1", seq, plans: [plan("p1", [{ itemId: "i1", state: "running" }])], items, topology: TOPOLOGY, coordinatorSeenAt: 5,
});

describe("edge session", () => {
  it("says hello with no cursor first, then resumes from seq and epoch after a reconnect", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    expect(h.last().sent[0]).toEqual({ type: "hello", cursor: null, epoch: null });
    h.deliver(snapshot(4));
    expect(h.session.state.view.seq).toBe(4);
    h.last().handlers.onClose();
    expect(h.session.state.connection).toBe("reconnecting");
    must(h.timers.shift(), "timer")();
    h.last().handlers.onOpen();
    expect(h.last().sent[0]).toEqual({ type: "hello", cursor: 4, epoch: "e1" });
  });

  it("routes command statuses to commands, attempt messages to the watched item, edge messages to the view", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    h.deliver(snapshot());
    const id = h.session.send({ operation: "ReconcileItem", input: { itemId: "i1" } }, "Reconcile");
    expect(h.last().sent.at(-1)).toMatchObject({ type: "command", commandId: id, operation: "ReconcileItem" });
    h.deliver({ type: "commandAccepted", commandId: id });
    expect(h.session.state.commands.entries[id]?.status).toBe("accepted");
    const viewBefore = h.session.state.view;

    h.session.watch("i1");
    expect(h.last().sent.at(-1)).toEqual({ type: "watch", itemId: "i1" });
    h.deliver({ type: "tail", frame: { itemId: "i1", attemptId: "a", threadId: "t", lines: ["hi"], threadStatus: "running", at: "x" } });
    h.deliver({ type: "ci", itemId: "i1", available: true, sha: "abc", summary: "2/3", phases: [{ name: "test", status: "running" }], at: "x" });
    // Another item's detail is ignored.
    h.deliver({ type: "tail", frame: { itemId: "other", attemptId: "a", threadId: "t", lines: ["no"], threadStatus: "running", at: "x" } });
    expect(h.session.state.attempt?.tail?.lines).toEqual(["hi"]);
    expect(h.session.state.attempt?.ci).toMatchObject({ available: true, summary: "2/3" });
    h.deliver({ type: "tailUnavailable", itemId: "i1", reason: "relay quiet" });
    expect(h.session.state.attempt?.tailUnavailable).toBe("relay quiet");
    expect(h.session.state.view).toBe(viewBefore);

    h.deliver({ type: "commandResult", commandId: id, ok: true, operation: { contractVersion: "1", operationId: "o", commandId: id, state: "succeeded", resourceId: "i1", resourceVersion: 2 } });
    expect(h.session.state.commands.entries[id]?.status).toBe("succeeded");
  });

  it("re-sends in-flight commands with the same commandId and the watch on a new socket", () => {
    const h = harness();
    h.session.start();
    const id = h.session.send({ operation: "CancelItem", input: { itemId: "i1", expectedVersion: 1 } }, "Cancel item", { confirmed: true });
    h.session.watch("i1");
    expect(h.last().sent).toEqual([]); // not open yet
    h.last().handlers.onOpen();
    expect(h.last().sent).toEqual([
      { type: "hello", cursor: null, epoch: null },
      { type: "command", commandId: id, operation: "CancelItem", input: { itemId: "i1", expectedVersion: 1 }, confirm: { confirmed: true } },
      { type: "watch", itemId: "i1" },
    ]);
  });

  it("asks once for a snapshot after a seq gap", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    h.deliver(snapshot(1));
    h.deliver({ type: "delta", seq: 3, plans: [], items: [], coordinatorSeenAt: 6 });
    h.deliver({ type: "delta", seq: 4, plans: [], items: [], coordinatorSeenAt: 7 });
    const hellos = h.last().sent.filter((m) => (m as { type: string }).type === "hello");
    expect(hellos).toEqual([{ type: "hello", cursor: null, epoch: null }, { type: "hello", cursor: null, epoch: null }]);
    expect(h.session.state.view.needsResync).toBe(true);
  });

  it("stops reconnecting on 401/403 and restarts on start()", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onRejected(403);
    h.last().handlers.onClose();
    expect(h.session.state.connection).toBe("auth-failed");
    expect(h.session.state.error).toContain("403");
    expect(h.timers).toHaveLength(0);
    h.session.start();
    expect(h.sockets).toHaveLength(2);
    expect(h.session.state.connection).toBe("connecting");
  });

  it("ignores junk and messages from a replaced socket", () => {
    const h = harness();
    h.session.start();
    const old = h.last();
    old.handlers.onOpen();
    h.deliver("not json at all");
    h.deliver({ type: "mystery" });
    old.handlers.onClose();
    must(h.timers.shift(), "timer")();
    old.handlers.onMessage(JSON.stringify(snapshot(9)));
    expect(h.session.state.view.seq).toBe(0);
  });

  it("wake() reconnects at once while waiting out a backoff", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onClose();
    expect(h.sockets).toHaveLength(1);
    h.session.wake();
    expect(h.sockets).toHaveLength(2);
  });

  it("backs off 1 s, 2 s, 4 s … capped at 30 s", () => {
    expect([0, 1, 2, 10].map((a) => reconnectDelay(a, () => 0.5))).toEqual([1000, 2000, 4000, 30000]);
  });
});

describe("asAttemptMessage", () => {
  it("strips terminal controls from tail lines, statuses, CI text and reasons", () => {
    const tail = asAttemptMessage({ type: "tail", frame: { itemId: "i", attemptId: "a", threadId: "t", lines: ["\u001b[32mok\u001b[0m", "bell\u0007", 7], threadStatus: "run\u0000ning", at: "now" } });
    expect(tail).toEqual({ type: "tail", frame: { itemId: "i", attemptId: "a", threadId: "t", lines: ["ok", "bell", ""], threadStatus: "running", at: "now" } });
    expect(asAttemptMessage({ type: "ci", itemId: "i", available: true, sha: "abc", summary: "\u001b[1m2/3\u001b[0m", phases: [{ name: "te\u0000st", status: "passed" }, null], at: "now" }))
      .toMatchObject({ summary: "2/3", phases: [{ name: "test", status: "passed" }] });
    expect(asAttemptMessage({ type: "ci", itemId: "i", available: false, reason: "no\u001b[2K ci", at: "now" })).toMatchObject({ reason: "no ci" });
    expect(asAttemptMessage({ type: "tailUnavailable", itemId: "i", reason: "\u009b31mquiet" })).toEqual({ type: "tailUnavailable", itemId: "i", reason: "quiet" });
    expect(asAttemptMessage({ type: "tail", frame: { itemId: "i" } })).toBeNull();
  });
});
