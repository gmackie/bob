import { describe, expect, it } from "vitest";

import { createEdgeLifecycle } from "./edge-lifecycle";
import { createSession } from "./edge-session";
import type { Session, SocketHandlers } from "./edge-session";
import { must } from "./test-fixtures";

function harness() {
  const sockets: { handlers: SocketHandlers; sent: unknown[]; closed: boolean }[] = [];
  const sessions: Session[] = [];
  const idle: { fn: () => void; cancelled: boolean }[] = [];
  let id = 0;
  const lifecycle = createEdgeLifecycle({
    idleCloseMs: 30_000,
    create: () => {
      const session = createSession({
        open: (handlers) => {
          const s = { handlers, sent: [] as unknown[], closed: false };
          sockets.push(s);
          return { send: (d) => s.sent.push(JSON.parse(d)), close: () => { s.closed = true; } };
        },
        newId: () => `cmd-${++id}`,
        random: () => 0.5,
        setTimer: () => 0,
        clearTimer: () => undefined,
      });
      sessions.push(session);
      return session;
    },
    setTimer: (fn) => { idle.push({ fn, cancelled: false }); return idle.length - 1; },
    clearTimer: (h) => { const t = idle[h as number]; if (t) t.cancelled = true; },
  });
  const last = () => must(sockets.at(-1), "socket");
  const open = () => last().handlers.onOpen();
  const live = () => sockets.filter((s) => !s.closed);
  return { lifecycle, sockets, sessions, idle, last, open, live };
}

describe("SDLC edge lifecycle", () => {
  it("stops in the background or inactive and reconnects on return while a screen uses it", () => {
    const h = harness();
    h.lifecycle.retain();
    h.open();
    expect(h.lifecycle.get().state.connection).toBe("live");

    h.lifecycle.appStateChanged("background");
    expect(h.live()).toHaveLength(0);
    expect(h.lifecycle.get().state.connection).not.toBe("live");

    h.lifecycle.appStateChanged("active");
    expect(h.sockets).toHaveLength(2);
    expect(h.live()).toHaveLength(1);

    h.open();
    h.lifecycle.appStateChanged("inactive");
    expect(h.live()).toHaveLength(0);
    h.lifecycle.appStateChanged("active");
    expect(h.live()).toHaveLength(1);
  });

  it("does not reconnect on return when no screen uses it, and starts when one mounts", () => {
    const h = harness();
    const release = h.lifecycle.retain();
    release();
    h.lifecycle.appStateChanged("background");
    expect(h.idle.at(-1)?.cancelled).toBe(true); // the idle close is moot once stopped
    h.lifecycle.appStateChanged("active");
    expect(h.live()).toHaveLength(0);
    h.lifecycle.retain();
    expect(h.live()).toHaveLength(1);
  });

  it("a screen mounting in the background waits for the foreground", () => {
    const h = harness();
    h.lifecycle.appStateChanged("background");
    h.lifecycle.retain();
    expect(h.sockets).toHaveLength(0);
    h.lifecycle.appStateChanged("active");
    expect(h.live()).toHaveLength(1);
  });

  it("closes a while after the last screen goes, unless one comes back first", () => {
    const h = harness();
    const a = h.lifecycle.retain();
    a();
    a(); // a double release does not underflow
    const b = h.lifecycle.retain();
    expect(must(h.idle[0], "idle").cancelled).toBe(true);
    b();
    must(h.idle.at(-1), "idle").fn();
    expect(h.live()).toHaveLength(0);
  });

  it("drops the session on sign-out and on an account change, so A's commands are never sent for B", () => {
    const h = harness();
    h.lifecycle.accountChanged("user-a");
    const release = h.lifecycle.retain();
    const a = h.lifecycle.get();
    a.send({ operation: "ControlPlan", input: { planId: "p1", expectedVersion: 1, action: "pause" } }, "Pause plan");
    expect(a.state.commands).not.toEqual(createSession({ open: () => ({ send: () => undefined, close: () => undefined }), newId: () => "x" }).state.commands);
    h.lifecycle.accountChanged("user-a"); // the same account: kept
    expect(h.lifecycle.get()).toBe(a);

    h.lifecycle.accountChanged(null);
    expect(h.live()).toHaveLength(0);
    release(); // the old screen unmounting after the reset changes nothing
    expect(h.idle).toHaveLength(0);

    h.lifecycle.accountChanged("user-b");
    h.lifecycle.retain();
    const b = h.lifecycle.get();
    expect(b).not.toBe(a);
    expect(b.state.commands).toEqual(createSession({ open: () => ({ send: () => undefined, close: () => undefined }), newId: () => "x" }).state.commands);
    h.open();
    expect(h.last().sent.some((m) => (m as { type?: string }).type === "command")).toBe(false);
  });

  it("switching straight from one account to another also drops the session", () => {
    const h = harness();
    h.lifecycle.accountChanged("user-a");
    h.lifecycle.retain();
    const a = h.lifecycle.get();
    h.lifecycle.accountChanged("user-b");
    expect(h.live()).toHaveLength(0);
    expect(h.lifecycle.get()).not.toBe(a);
  });
});
