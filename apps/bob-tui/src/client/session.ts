// The live session with the SdlcEdge: one socket at a time, the view folded through
// reduce(), command statuses routed to the command model, reconnects with backoff, and
// in-flight commands re-sent with their original commandId on every new socket.
// The socket is injected, so tests drive it without a network.
import { randomUUID } from "node:crypto";

import { emptyView, reduce, type ClientCommand, type CommandOption, type Confirmation, type EdgeView } from "@bob/sdlc-view";

import { asAttemptMessage, emptyAttempt, reduceAttempt, watchMessage, type AttemptState } from "../model/attempt";
import { applyStatus, asCommandStatus, clientCommand, emptyCommands, expire, recordSent, toResend, type CommandsState } from "../model/commands";
import { asEdgeMessage, createBackoff, helloFor } from "./edge-protocol";

export type Connection = "connecting" | "live" | "reconnecting" | "auth-failed";

/**
 * A command written to a live socket is answered by the edge at once (commandAccepted or
 * commandRejected, or its stored result). No answer this long means the socket is half
 * dead though it never closed: it is replaced, and onOpen resends the command with the
 * same commandId, which the edge dedupes (BOB-89).
 */
export const ACK_TIMEOUT_MS = 10_000;

export interface SessionState {
  view: EdgeView;
  commands: CommandsState;
  /** Live attempt detail (tail, CI, unavailable), kept apart from the view. */
  attempt: AttemptState;
  connection: Connection;
  /** Why the session stopped reconnecting (auth), or the last socket error. */
  error: string | null;
}

export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
  /** The upgrade was refused with an HTTP status (401/403 from the edge). */
  onRejected(status: number): void;
}

export interface SocketLike { send(data: string): void; close(): void }
export type OpenSocket = (handlers: SocketHandlers) => SocketLike;

export interface SessionOptions {
  open: OpenSocket;
  now?: () => number;
  newId?: () => string;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Session {
  readonly state: SessionState;
  start(): void;
  stop(): void;
  /** Records and sends a command; while disconnected it is sent on the next socket. Returns the commandId. */
  send(option: CommandOption, label: string, confirm?: Confirmation): string;
  /** Marks in-flight commands older than the edge's expiry as expired. */
  tick(): void;
  /** Watch one item's attempt detail (null stops); re-sent on every new socket. */
  watch(itemId: string | null): void;
  subscribe(listener: (state: SessionState) => void): () => void;
}

export function createSession(options: SessionOptions): Session {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const backoff = createBackoff(options.random);
  const listeners = new Set<(s: SessionState) => void>();
  let state: SessionState = { view: emptyView(), commands: emptyCommands(), attempt: emptyAttempt(), connection: "connecting", error: null };
  let socket: SocketLike | null = null;
  let isOpen = false;
  let stopped = false;
  let timer: unknown;
  let resyncRequested = false;
  /** commandId → when it was written to the current socket, until the edge answers it. */
  const unacked = new Map<string, number>();
  let ackTimer: unknown;

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };
  const write = (message: unknown) => { if (socket && isOpen) socket.send(JSON.stringify(message)); };
  const disarmAck = () => {
    if (ackTimer !== undefined) clearTimer(ackTimer);
    ackTimer = undefined;
  };
  const armAck = () => {
    if (ackTimer !== undefined || unacked.size === 0) return;
    const due = Math.min(...unacked.values()) + ACK_TIMEOUT_MS;
    ackTimer = setTimer(checkAck, Math.max(0, due - now()));
  };
  const checkAck = () => {
    ackTimer = undefined;
    if (!socket || !isOpen) return;
    const overdue = [...unacked.values()].some((at) => now() - at >= ACK_TIMEOUT_MS);
    if (!overdue) { armAck(); return; }
    const dead = socket;
    socket = null;
    isOpen = false;
    unacked.clear();
    dead.close();
    set({ connection: "reconnecting", error: "The edge did not answer a command; reconnecting to send it again." });
    connect();
  };
  /** Writes a command and starts its answer deadline when it actually went out. */
  const writeCommand = (command: ClientCommand) => {
    if (!socket || !isOpen) return;
    socket.send(JSON.stringify(command));
    unacked.set(command.commandId, now());
    armAck();
  };

  const connect = () => {
    if (stopped) return;
    isOpen = false;
    unacked.clear();
    disarmAck();
    let current: SocketLike | null = null;
    const mine = () => socket === current && current !== null;
    current = options.open({
      onOpen() {
        if (!mine()) return;
        isOpen = true;
        resyncRequested = state.view.needsResync;
        set({ connection: "live", error: null });
        write(helloFor(state.view));
        for (const command of toResend(state.commands)) writeCommand(command);
        // Watches live per socket on the edge: a new socket watches nothing until told.
        if (state.attempt.watching !== null) write(watchMessage(state.attempt.watching));
      },
      onMessage(data) {
        if (!mine()) return;
        let value: unknown;
        try { value = JSON.parse(data); } catch { return; }
        const live = asAttemptMessage(value);
        if (live) { backoff.heard(); set({ attempt: reduceAttempt(state.attempt, live) }); return; }
        const status = asCommandStatus(value);
        if (status) { backoff.heard(); unacked.delete(status.commandId); set({ commands: applyStatus(state.commands, status) }); return; }
        const message = asEdgeMessage(value);
        if (!message) return;
        backoff.heard();
        const view = reduce(state.view, message);
        if (!view.needsResync) resyncRequested = false;
        else if (!resyncRequested) {
          resyncRequested = true;
          write({ type: "hello", cursor: null, epoch: null });
        }
        set({ view });
      },
      onClose() {
        if (!mine()) return;
        socket = null;
        isOpen = false;
        unacked.clear();
        disarmAck();
        if (stopped || state.connection === "auth-failed") return;
        set({ connection: "reconnecting" });
        timer = setTimer(connect, backoff.nextDelay());
      },
      onRejected(status) {
        if (!mine()) return;
        if (status === 401 || status === 403) {
          stopped = true;
          set({
            connection: "auth-failed",
            error: status === 401
              ? "The edge refused the API key (401). Run bob-tui login again."
              : "This account is not an SDLC viewer (403). Ask for it to be added to SDLC_VIEWER_USER_IDS.",
          });
        } else set({ error: `The edge refused the socket: HTTP ${status}` });
      },
    });
    socket = current;
  };

  return {
    get state() { return state; },
    start() { stopped = false; connect(); },
    stop() {
      stopped = true;
      clearTimer(timer);
      unacked.clear();
      disarmAck();
      const s = socket;
      socket = null;
      isOpen = false;
      s?.close();
    },
    send(option, label, confirm) {
      const command = clientCommand(newId(), option, confirm);
      set({ commands: recordSent(state.commands, command, label, now()) });
      writeCommand(command);
      return command.commandId;
    },
    watch(itemId) {
      if (itemId === state.attempt.watching) return;
      set({ attempt: { ...state.attempt, watching: itemId } });
      write(watchMessage(itemId));
    },
    tick() {
      const commands = expire(state.commands, now());
      if (commands !== state.commands) set({ commands });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
