import { describe, expect, it } from "vitest";
import type { CommandOption } from "@bob/sdlc-view";

import { FIXTURE_NOW, fixtureView } from "../fixtures";
import { reconnectDelay } from "./edge-protocol";
import { ACK_TIMEOUT_MS, createSession, type SocketHandlers } from "./session";

const option: CommandOption = { label: "Pause plan", tier: 1, command: { operation: "ControlPlan", input: { planId: "p1", expectedVersion: 2, action: "pause" } } };

function harness() {
  const sockets: Array<{ handlers: SocketHandlers; sent: unknown[]; closed: boolean }> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let ids = 0;
  let clock = FIXTURE_NOW;
  const session = createSession({
    open: (handlers) => {
      const s = { handlers, sent: [] as unknown[], closed: false };
      sockets.push(s);
      return { send: (d) => s.sent.push(JSON.parse(d)), close: () => { s.closed = true; } };
    },
    now: () => clock,
    newId: () => `cmd-${++ids}`,
    random: () => 0.5,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
  });
  const last = () => sockets[sockets.length - 1]!;
  return { session, sockets, timers, last, advance: (ms: number) => { clock += ms; } };
}

const snapshot = (seq: number, epoch = "e1") => {
  const v = fixtureView();
  return JSON.stringify({ type: "snapshot", epoch, seq, plans: Object.values(v.plans), items: Object.values(v.items), topology: v.topology, coordinatorSeenAt: FIXTURE_NOW });
};

describe("edge session", () => {
  it("says hello with a null cursor first, then resumes from seq and epoch after a reconnect", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    expect(h.last().sent).toEqual([{ type: "hello", cursor: null, epoch: null }]);
    h.last().handlers.onMessage(snapshot(10));
    expect(h.session.state.view.seq).toBe(10);
    expect(h.session.state.connection).toBe("live");

    h.last().handlers.onClose();
    expect(h.session.state.connection).toBe("reconnecting");
    expect(h.timers[0]!.ms).toBe(reconnectDelay(0, () => 0.5));
    h.timers[0]!.fn();
    h.last().handlers.onOpen();
    expect(h.last().sent).toEqual([{ type: "hello", cursor: 10, epoch: "e1" }]);
  });

  it("asks once for a snapshot after a seq gap", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    h.last().handlers.onMessage(snapshot(10));
    const delta = (seq: number) => JSON.stringify({ type: "delta", seq, plans: [], items: [], coordinatorSeenAt: null });
    h.last().handlers.onMessage(delta(12));
    h.last().handlers.onMessage(delta(13));
    expect(h.last().sent.slice(1)).toEqual([{ type: "hello", cursor: null, epoch: null }]);
    h.last().handlers.onMessage(snapshot(14));
    expect(h.session.state.view.needsResync).toBe(false);
  });

  it("routes command statuses to the command model and ignores junk", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    const id = h.session.send(option, "Pause plan p1");
    expect(h.last().sent[1]).toEqual({ type: "command", commandId: id, operation: "ControlPlan", input: { planId: "p1", expectedVersion: 2, action: "pause" } });
    h.last().handlers.onMessage(JSON.stringify({ type: "commandAccepted", commandId: id }));
    expect(h.session.state.commands.entries[id]!.status).toBe("accepted");
    h.last().handlers.onMessage("not json");
    h.last().handlers.onMessage(JSON.stringify({ type: "mystery" }));
    expect(h.session.state.view.epoch).toBeNull();
  });

  it("re-sends pending and accepted commands with the same commandId after a reconnect", () => {
    const h = harness();
    h.session.start();
    // Sent while still connecting: queued, not written.
    const first = h.session.send(option, "Pause plan p1", { confirmed: true });
    expect(h.last().sent).toEqual([]);
    h.last().handlers.onOpen();
    expect(h.last().sent).toEqual([
      { type: "hello", cursor: null, epoch: null },
      expect.objectContaining({ type: "command", commandId: first, confirm: { confirmed: true } }),
    ]);
    const second = h.session.send(option, "again");
    h.last().handlers.onMessage(JSON.stringify({ type: "commandResult", commandId: second, ok: false, error: { code: "VersionConflict", message: "", retryable: false } }));
    h.last().handlers.onClose();
    h.timers.at(-1)!.fn(); // the reconnect (an ack deadline was set first)
    h.last().handlers.onOpen();
    expect(h.last().sent.slice(1)).toEqual([expect.objectContaining({ commandId: first })]);
  });

  it("stops reconnecting when the edge refuses the key", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onRejected(401);
    h.last().handlers.onClose();
    expect(h.session.state.connection).toBe("auth-failed");
    expect(h.session.state.error).toMatch(/bob-tui login/);
    expect(h.timers).toEqual([]);
  });

  it("keeps reconnecting on other upgrade failures, and ignores events from a replaced socket", () => {
    const h = harness();
    h.session.start();
    const old = h.last();
    old.handlers.onRejected(502);
    old.handlers.onClose();
    expect(h.session.state.connection).toBe("reconnecting");
    h.timers[0]!.fn();
    old.handlers.onOpen();
    expect(old.sent).toEqual([]);
    expect(h.session.state.connection).toBe("reconnecting");
  });

  it("stop closes the socket and does not reconnect", () => {
    const h = harness();
    h.session.start();
    const s = h.last();
    h.session.stop();
    expect(s.closed).toBe(true);
    s.handlers.onClose();
    expect(h.timers).toEqual([]);
  });

  it("notifies subscribers", () => {
    const h = harness();
    const seen: string[] = [];
    const off = h.session.subscribe((s) => seen.push(s.connection));
    h.session.start();
    h.last().handlers.onOpen();
    off();
    h.last().handlers.onClose();
    expect(seen).toEqual(["live"]);
  });

  it("sends watch when it changes, re-sends it after the hello on a new socket, and routes attempt messages", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    h.session.watch("item-p1");
    h.session.watch("item-p1");
    expect(h.last().sent.slice(1)).toEqual([{ type: "watch", itemId: "item-p1" }]);
    h.last().handlers.onMessage(JSON.stringify({ type: "tail", frame: { itemId: "item-p1", attemptId: "att-p1", threadId: "t", lines: ["hi"], threadStatus: "running", at: "1" } }));
    h.last().handlers.onMessage(JSON.stringify({ type: "tailUnavailable", itemId: "item-a1", reason: "silent" }));
    expect(h.session.state.attempt.tails["item-p1"]?.lines).toEqual(["hi"]);
    expect(h.session.state.attempt.unavailable).toEqual({ "item-a1": "silent" });
    expect(h.session.state.view.epoch).toBeNull();
    h.last().handlers.onClose();
    h.timers.at(-1)!.fn();
    h.last().handlers.onOpen();
    expect(h.last().sent).toEqual([{ type: "hello", cursor: null, epoch: null }, { type: "watch", itemId: "item-p1" }]);
    h.session.watch(null);
    expect(h.last().sent.at(-1)).toEqual({ type: "watch", itemId: null });
  });

  it("replaces a socket that never answers a command, and resends it with the same commandId (BOB-89)", () => {
    const h = harness();
    h.session.start();
    const first = h.last();
    first.handlers.onOpen();
    first.handlers.onMessage(snapshot(10));
    h.session.send(option, "Pause plan");
    const deadline = h.timers.find((t) => t.ms === ACK_TIMEOUT_MS)!;
    expect(deadline).toBeDefined();

    h.advance(ACK_TIMEOUT_MS);
    deadline.fn();
    expect(first.closed).toBe(true);
    expect(h.sockets).toHaveLength(2);
    expect(h.session.state.connection).toBe("reconnecting");

    h.last().handlers.onOpen();
    const resent = h.last().sent.filter((m) => (m as { type: string }).type === "command");
    expect(resent).toEqual([expect.objectContaining({ commandId: "cmd-1", operation: "ControlPlan" })]);
    // Events from the replaced socket are ignored.
    first.handlers.onClose();
    expect(h.session.state.connection).toBe("live");
  });

  it("keeps the socket when the edge answers in time, and waits for the latest command's own deadline", () => {
    const h = harness();
    h.session.start();
    h.last().handlers.onOpen();
    h.session.send(option, "Pause plan");
    h.last().handlers.onMessage(JSON.stringify({ type: "commandAccepted", commandId: "cmd-1" }));
    h.advance(ACK_TIMEOUT_MS - 1000);
    h.session.send(option, "Pause plan");
    const first = h.timers.find((t) => t.ms === ACK_TIMEOUT_MS)!;
    h.advance(1000);
    first.fn();
    // cmd-1 was answered; cmd-2 has 9 s left, so the socket stays and a new deadline is set.
    expect(h.sockets).toHaveLength(1);
    expect(h.last().closed).toBe(false);
    expect(h.timers.at(-1)!.ms).toBe(ACK_TIMEOUT_MS - 1000);
    h.last().handlers.onMessage(JSON.stringify({ type: "commandRejected", commandId: "cmd-2", code: "rate-limited", message: "slow down" }));
    h.advance(ACK_TIMEOUT_MS);
    h.timers.at(-1)!.fn();
    expect(h.sockets).toHaveLength(1);
    expect(h.session.state.commands.entries["cmd-2"]!.status).toBe("rejected");
  });

  it("starts no deadline for a command sent while disconnected; it starts when the resend goes out", () => {
    const h = harness();
    h.session.start();
    h.session.send(option, "Pause plan");
    expect(h.timers.some((t) => t.ms === ACK_TIMEOUT_MS)).toBe(false);
    h.last().handlers.onOpen();
    expect(h.timers.some((t) => t.ms === ACK_TIMEOUT_MS)).toBe(true);
  });
});
