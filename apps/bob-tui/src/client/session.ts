// The live session with the SdlcEdge: one socket at a time, the view folded through
// reduce(), command statuses routed to the command model, reconnects with backoff, and
// in-flight commands re-sent with their original commandId on every new socket.
// The socket is injected, so tests drive it without a network.
import { randomUUID } from "node:crypto";

import { emptyView, reduce, type CommandOption, type Confirmation, type EdgeView } from "@bob/sdlc-view";

import { applyStatus, asCommandStatus, clientCommand, emptyCommands, expire, recordSent, toResend, type CommandsState } from "../model/commands";
import { asEdgeMessage, createBackoff, helloFor } from "./edge-protocol";

export type Connection = "connecting" | "live" | "reconnecting" | "auth-failed";

export interface SessionState {
  view: EdgeView;
  commands: CommandsState;
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
  subscribe(listener: (state: SessionState) => void): () => void;
}

export function createSession(options: SessionOptions): Session {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const backoff = createBackoff(options.random);
  const listeners = new Set<(s: SessionState) => void>();
  let state: SessionState = { view: emptyView(), commands: emptyCommands(), connection: "connecting", error: null };
  let socket: SocketLike | null = null;
  let isOpen = false;
  let stopped = false;
  let timer: unknown;
  let resyncRequested = false;

  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };
  const write = (message: unknown) => { if (socket && isOpen) socket.send(JSON.stringify(message)); };

  const connect = () => {
    if (stopped) return;
    isOpen = false;
    let current: SocketLike | null = null;
    const mine = () => socket === current && current !== null;
    current = options.open({
      onOpen() {
        if (!mine()) return;
        isOpen = true;
        resyncRequested = state.view.needsResync;
        set({ connection: "live", error: null });
        write(helloFor(state.view));
        for (const command of toResend(state.commands)) write(command);
      },
      onMessage(data) {
        if (!mine()) return;
        let value: unknown;
        try { value = JSON.parse(data); } catch { return; }
        const status = asCommandStatus(value);
        if (status) { backoff.heard(); set({ commands: applyStatus(state.commands, status) }); return; }
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
      const s = socket;
      socket = null;
      isOpen = false;
      s?.close();
    },
    send(option, label, confirm) {
      const command = clientCommand(newId(), option, confirm);
      set({ commands: recordSent(state.commands, command, label, now()) });
      write(command);
      return command.commandId;
    },
    tick() {
      const commands = expire(state.commands, now());
      if (commands !== state.commands) set({ commands });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
