// The live session with the SdlcEdge on the phone: one socket at a time, the view folded
// through reduce(), command statuses routed to the command model, attempt detail (tail,
// CI) for the watched items (the focused screen plus the Arcade desks), shipped-today
// entries on request, reconnects with capped jittered backoff, and in-flight commands plus
// the watch re-sent on every new socket. The socket is injected, so node
// tests drive it without a network. Ported from the web edge-client and bob-tui session.
import { emptyView, mergeShipped, parseShippedMessage, reduce, stripTerminalControls, watchedIds } from "@bob/sdlc-view";
import type {CiMessage, ClientCommand, CommandInput, Confirmation, EdgeMessage, EdgeView, LiveActivityRegistration, ShippedEntry, ShippedRequest, TailFrame, WatchMessage} from "@bob/sdlc-view";

import {
  asCommandStatus,
  commandsToResend,
  emptyCommands,
  reduceCommands
  
  
} from "./commands-model";
import type {CommandsState, EdgeConnection} from "./commands-model";

export interface HelloMessage { type: "hello"; cursor: number | null; epoch: string | null }

/** Resume from the view's seq and epoch, or ask for a snapshot when there is no view or it needs a resync. */
export function helloFor(view: EdgeView): HelloMessage {
  if (view.epoch === null || view.needsResync) return { type: "hello", cursor: null, epoch: null };
  return { type: "hello", cursor: view.seq, epoch: view.epoch };
}

/** One already-parsed socket message as an edge message, else null. */
export function asEdgeMessage(value: unknown): EdgeMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<EdgeMessage> & Record<string, unknown>;
  if (message.type === "status") return message as EdgeMessage;
  if (message.type !== "snapshot" && message.type !== "delta") return null;
  if (!Number.isSafeInteger(message.seq) || !Array.isArray(message.plans) || !Array.isArray(message.items)) return null;
  if (message.type === "snapshot" && (typeof message.epoch !== "string" || !Array.isArray(message.topology))) return null;
  return message as EdgeMessage;
}

export type AttemptEvent =
  | { type: "tail"; frame: TailFrame }
  | CiMessage
  | { type: "tailUnavailable"; itemId: string; reason: string };

/** Agent- or CI-sourced text for one line of UI: terminal escapes and control characters removed. */
const clean = (value: unknown): string => (typeof value === "string" ? stripTerminalControls(value) : "");

/**
 * One already-parsed socket message as attempt detail (tail, ci, tailUnavailable), else null.
 * Text from the agent or CI (tail lines, statuses, reasons, phase names) is stripped of
 * terminal controls here, once, the same as the web and TUI surfaces.
 */
export function asAttemptMessage(value: unknown): AttemptEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.type === "tail") {
    const f = m.frame as Record<string, unknown> | undefined;
    if (!f || typeof f.itemId !== "string" || !Array.isArray(f.lines)) return null;
    const frame = { ...f, lines: f.lines.map(clean), threadStatus: clean(f.threadStatus) } as unknown as TailFrame;
    return { type: "tail", frame };
  }
  if (m.type === "ci") {
    if (typeof m.itemId !== "string" || typeof m.available !== "boolean") return null;
    if (m.available) {
      if (!Array.isArray(m.phases)) return null;
      const phases = (m.phases as unknown[])
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
        .map((p) => ({ ...p, name: clean(p.name) }));
      return { ...m, summary: clean(m.summary), phases } as unknown as AttemptEvent;
    }
    return { ...m, reason: clean(m.reason) } as unknown as AttemptEvent;
  }
  if (m.type === "tailUnavailable") {
    return typeof m.itemId === "string" ? { type: "tailUnavailable", itemId: m.itemId, reason: clean(m.reason) } : null;
  }
  return null;
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_JITTER = 0.2;

/** Capped exponential backoff, 1 s … 30 s, ±20%. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * random()));
}

/** A socket counts as healthy once the edge sent a valid message on it, not when it opens. */
export function createBackoff(random: () => number = Math.random) {
  let attempt = 0;
  return {
    heard() { attempt = 0; },
    nextDelay() { return reconnectDelay(attempt++, random); },
  };
}

/** Live detail for one watched item. Dropped when the item leaves the watch set. */
export interface AttemptDetail {
  itemId: string;
  tail: TailFrame | null;
  ci: CiMessage | null;
  /** Why the tail is unavailable, when the edge said so. */
  tailUnavailable: string | null;
}

export interface SessionState {
  view: EdgeView;
  commands: CommandsState;
  connection: EdgeConnection;
  /** Why the session stopped reconnecting (auth), or the last refusal. */
  error: string | null;
  /** Live detail for the focused item (watch()), else null. */
  attempt: AttemptDetail | null;
  /** Live detail per watched item: the focused item and the Arcade desks (BOB-98). */
  attempts: Readonly<Record<string, AttemptDetail>>;
  /**
   * The ids this session asks the edge to watch, in order: the focused item first, then
   * desks, capped at MAX_WATCHED_ITEMS (BOB-94). A desk outside this list gets no detail.
   */
  watching: readonly string[];
  /** What reached production recently (BOB-95), newest first; null until followShipped(). */
  shipped: readonly ShippedEntry[] | null;
}

export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(): void;
  /** The upgrade was refused with an HTTP status, when the platform reports it. */
  onRejected(status: number): void;
}

export interface SocketLike { send(data: string): void; close(): void }
export type OpenSocket = (handlers: SocketHandlers) => SocketLike;

/**
 * A command written to a live socket is answered by the edge at once (commandAccepted or
 * commandRejected, or its stored result). No answer this long means the socket is half
 * dead though it never closed: it is replaced, and onOpen resends the command with the
 * same commandId, which the edge dedupes (BOB-89).
 */
export const ACK_TIMEOUT_MS = 10_000;

export interface SessionOptions {
  open: OpenSocket;
  newId: () => string;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Session {
  readonly state: SessionState;
  start(): void;
  stop(): void;
  /**
   * Reconnect now (app came to the foreground, device woke), skipping any backoff wait. An
   * open socket is closed and replaced too: after a sleep it may be half dead (no close
   * event yet), and it must not keep showing a stale view as live.
   */
  wake(): void;
  /** Records and sends a command; while disconnected it is sent on the next socket. Returns the commandId. */
  send(command: CommandInput, label: string, confirm?: Confirmation): string;
  /** Watch one item's attempt detail (the focused screen's); null stops. Re-sent on every new socket. */
  watch(itemId: string | null): void;
  /**
   * Watch these items for the Arcade desks too (BOB-98), after the focused item, within the
   * edge's cap. An empty list stops. A new watch is written only when the set changes.
   */
  watchDesks(itemIds: readonly string[]): void;
  /** Ask the edge for shipped-today entries and their updates (BOB-95), now and on every new socket. */
  followShipped(): void;
  /**
   * Register an iOS Live Activity's push token for an item (token null: stop it). Sent now
   * when the socket is live, else on the next socket; only the latest per item is kept.
   */
  registerLiveActivity(registration: LiveActivityRegistration): void;
  subscribe(listener: (state: SessionState) => void): () => void;
}

export function createSession(options: SessionOptions): Session {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const backoff = createBackoff(options.random);
  const listeners = new Set<(s: SessionState) => void>();
  let state: SessionState = { view: emptyView(), commands: emptyCommands(), connection: "connecting", error: null, attempt: null, attempts: {}, watching: [], shipped: null };
  let socket: SocketLike | null = null;
  let isOpen = false;
  let stopped = true;
  let timer: unknown;
  let resyncRequested = false;
  let focus: string | null = null;
  let deskIds: readonly string[] = [];
  let shippedWanted = false;
  /** Live Activity registrations not yet written to a live socket, latest per item. */
  const unsentActivities = new Map<string, LiveActivityRegistration>();
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
    if (!socket || !isOpen || stopped) return;
    const overdue = [...unacked.values()].some((at) => now() - at >= ACK_TIMEOUT_MS);
    if (!overdue) { armAck(); return; }
    dropSocket();
    set({ connection: "reconnecting" });
    connect();
  };
  /** Writes a command and starts its answer deadline when it actually went out. */
  const writeCommand = (command: ClientCommand) => {
    if (!socket || !isOpen) return;
    socket.send(JSON.stringify(command));
    unacked.set(command.commandId, now());
    armAck();
  };

  const emptyDetail = (itemId: string): AttemptDetail => ({ itemId, tail: null, ci: null, tailUnavailable: null });
  const withAttempts = (attempts: Record<string, AttemptDetail>): Partial<SessionState> => ({
    attempts,
    attempt: focus ? attempts[focus] ?? null : null,
  });
  /** The single form while only one screen watches (what the edge has always taken); the set form for desks. */
  const watchMessage = (ids: readonly string[]): WatchMessage =>
    deskIds.length === 0 ? { type: "watch", itemId: ids[0] ?? null } : { type: "watch", itemIds: [...ids] };
  /** Recomputes the watch set; writes it and resets detail for ids that left or joined. */
  const applyWatch = () => {
    const ids = watchedIds({ type: "watch", itemIds: focus ? [focus, ...deskIds] : [...deskIds] });
    const same = ids.length === state.watching.length && ids.every((id, i) => id === state.watching[i]);
    const attempts: Record<string, AttemptDetail> = {};
    for (const id of ids) attempts[id] = state.attempts[id] ?? emptyDetail(id);
    set({ watching: ids, ...withAttempts(attempts) });
    if (!same) write(watchMessage(ids));
  };

  const onAttempt = (event: AttemptEvent) => {
    const itemId = event.type === "tail" ? event.frame.itemId : event.itemId;
    if (!state.watching.includes(itemId)) return;
    const base = state.attempts[itemId] ?? emptyDetail(itemId);
    const next: AttemptDetail =
      event.type === "tail" ? { ...base, tail: event.frame, tailUnavailable: null }
      : event.type === "ci" ? { ...base, ci: event }
      : { ...base, tailUnavailable: event.reason };
    set(withAttempts({ ...state.attempts, [itemId]: next }));
  };

  /** Closes the current socket (its late events are ignored) and cancels a pending reconnect. */
  const dropSocket = () => {
    clearTimer(timer);
    timer = undefined;
    unacked.clear();
    disarmAck();
    const s = socket;
    socket = null;
    isOpen = false;
    s?.close();
  };

  const connect = () => {
    if (stopped) return;
    timer = undefined;
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
        for (const command of commandsToResend(state.commands)) writeCommand(command);
        if (state.watching.length) write(watchMessage(state.watching));
        if (shippedWanted) write({ type: "shipped" } satisfies ShippedRequest);
        for (const registration of unsentActivities.values()) write(registration);
        unsentActivities.clear();
      },
      onMessage(data) {
        if (!mine()) return;
        let value: unknown;
        try { value = JSON.parse(data); } catch { return; }
        const status = asCommandStatus(value);
        if (status) { backoff.heard(); unacked.delete(status.commandId); set({ commands: reduceCommands(state.commands, status) }); return; }
        const attempt = asAttemptMessage(value);
        if (attempt) { backoff.heard(); onAttempt(attempt); return; }
        const shipped = parseShippedMessage(value);
        if (shipped) { backoff.heard(); set({ shipped: mergeShipped(state.shipped ?? [], shipped) }); return; }
        const message = asEdgeMessage(value);
        if (!message) return;
        backoff.heard();
        const view = reduce(state.view, message);
        if (!view.needsResync) resyncRequested = false;
        else if (!resyncRequested) {
          resyncRequested = true;
          write({ type: "hello", cursor: null, epoch: null } satisfies HelloMessage);
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
              ? "The SDLC edge did not accept your session (401). Sign in again."
              : "This account cannot open the SDLC view (403). Ask for it to be added to SDLC_VIEWER_USER_IDS.",
          });
        } else set({ error: `The SDLC edge refused the socket: HTTP ${status}` });
      },
    });
    socket = current;
  };

  return {
    get state() { return state; },
    start() {
      if (!stopped) return;
      stopped = false;
      if (state.connection === "auth-failed") set({ connection: "connecting", error: null });
      connect();
    },
    stop() {
      stopped = true;
      dropSocket();
      // No socket, so not live: a later start() reconnects and the banner says so meanwhile.
      if (state.connection === "live") set({ connection: "reconnecting" });
    },
    wake() {
      if (stopped) return;
      dropSocket();
      set({ connection: "reconnecting" });
      connect();
    },
    send(command, label, confirm) {
      const message = { type: "command", commandId: options.newId(), ...command, ...(confirm ? { confirm } : {}) } as ClientCommand;
      set({ commands: reduceCommands(state.commands, { type: "sent", command: message, label }) });
      writeCommand(message);
      return message.commandId;
    },
    watch(itemId) {
      if (itemId === focus) return;
      focus = itemId;
      applyWatch();
    },
    watchDesks(itemIds) {
      if (itemIds.length === deskIds.length && itemIds.every((id, i) => id === deskIds[i])) return;
      deskIds = [...itemIds];
      applyWatch();
    },
    followShipped() {
      if (shippedWanted) return;
      shippedWanted = true;
      write({ type: "shipped" } satisfies ShippedRequest);
    },
    registerLiveActivity(registration) {
      if (socket && isOpen) { unsentActivities.delete(registration.itemId); write(registration); }
      else unsentActivities.set(registration.itemId, registration);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
