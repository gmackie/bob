// The SDLC edge client's logic without a socket or React, so node tests cover it.
// use-sdlc-edge.ts wires it to a browser WebSocket.
import { emptyView, reduce, type ClientCommand, type CommandInput, type Confirmation, type EdgeMessage, type EdgeView } from "@bob/sdlc-view";

import { emptyAttempt, parseAttemptMessage, reduceAttempt, watchMessage, type AttemptState } from "./attempt-model";
import { commandsToResend, emptyCommands, parseCommandStatus, reduceCommands, type CommandsState } from "./commands-model";

export type EdgeConnection = "connecting" | "live" | "reconnecting";

/** What the client sends: see the protocol note on EdgeMessage in @bob/sdlc-view. */
export interface HelloMessage { type: "hello"; cursor: number | null; epoch: string | null }

/**
 * The hello for a (re)connect: resume from the view's seq and epoch, or ask for a
 * snapshot (cursor null) when there is no view yet or the view needs a resync.
 */
export function helloFor(view: EdgeView): HelloMessage {
  if (view.epoch === null || view.needsResync) return { type: "hello", cursor: null, epoch: null };
  return { type: "hello", cursor: view.seq, epoch: view.epoch };
}

/** Parses one socket message; anything that is not an edge message is null. */
export function parseEdgeMessage(data: unknown): EdgeMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<EdgeMessage> & Record<string, unknown>;
  if (message.type === "status") return message as EdgeMessage;
  if (message.type !== "snapshot" && message.type !== "delta") return null;
  if (!Number.isSafeInteger(message.seq) || !Array.isArray(message.plans) || !Array.isArray(message.items)) return null;
  if (message.type === "snapshot" && (typeof message.epoch !== "string" || !Array.isArray(message.topology))) return null;
  return message as EdgeMessage;
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_JITTER = 0.2;
/**
 * Capped exponential backoff, 1 s, 2 s, 4 s ... 30 s, each ±20% so viewers that lost the
 * edge together do not all reconnect in the same instant. `random` is injectable for tests.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * random()));
}

/**
 * The backoff across reconnects. A socket counts as healthy only once the edge has sent
 * a valid message on it, not when it opens: a socket that opens and is closed at once
 * (a failing Durable Object, say) keeps backing off.
 */
export function createBackoff(random: () => number = Math.random) {
  let attempt = 0;
  return {
    /** A valid message arrived on the current socket. */
    heard() { attempt = 0; },
    /** The socket closed: how long to wait before the next one. */
    nextDelay() { return reconnectDelay(attempt++, random); },
  };
}

/**
 * A command written to a live socket is answered by the edge at once (commandAccepted or
 * commandRejected, or its stored result). No answer this long means the socket is half
 * dead though it never closed; the hook replaces it, and opened() resends the command with
 * the same commandId, which the edge dedupes (BOB-89).
 */
export const ACK_TIMEOUT_MS = 10_000;

export interface EdgeClient {
  readonly view: EdgeView;
  /** Whether a command written to the current socket has gone ACK_TIMEOUT_MS without an answer. */
  overdue(now?: number): boolean;
  /** The socket opened: say hello. */
  opened(): void;
  /**
   * One socket message: fold it into the view, and ask once for a snapshot after a seq gap.
   * Returns whether it was a valid edge message; the hook resets its backoff on the first one.
   */
  received(data: unknown): boolean;
  readonly commands: CommandsState;
  /**
   * Sends a command with a fresh commandId and tracks it. If no socket is open the
   * command stays pending and goes out on the next open. Returns the commandId.
   */
  send(command: CommandInput, label: string, confirm?: Confirmation): string;
  /** Live attempt detail (tail, CI, unavailable): kept apart from the view, never reduced into it. */
  readonly attempt: AttemptState;
  /**
   * Watch one item's attempt detail, or none (null). Sent at once when it changes, and
   * again after the hello on every new socket, since the edge forgets watches on close.
   */
  watch(itemId: string | null): void;
}

/**
 * Keeps the view across reconnects. When a delta leaves the view with needsResync set,
 * it sends one hello with cursor null on the open socket; the edge answers with a
 * snapshot, which clears needsResync. It asks again only after that, or on a new socket.
 */
export function createEdgeClient(options: {
  /** Writes to the open socket; returns exactly false when nothing was written (no open socket). */
  send: (data: string) => unknown;
  now?: () => number;
  onView?: (view: EdgeView) => void;
  onCommands?: (commands: CommandsState) => void;
  onAttempt?: (attempt: AttemptState) => void;
  initial?: EdgeView;
  newCommandId?: () => string;
}): EdgeClient {
  let view = options.initial ?? emptyView();
  let commands = emptyCommands();
  let attempt = emptyAttempt();
  let resyncRequested = false;
  const newCommandId = options.newCommandId ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  /** commandId → when it was written to the current socket, until the edge answers it. */
  const unacked = new Map<string, number>();
  const sendCommand = (command: ClientCommand) => {
    if (options.send(JSON.stringify(command)) !== false) unacked.set(command.commandId, now());
  };
  const hello = (message: HelloMessage) => options.send(JSON.stringify(message));
  const setCommands = (next: CommandsState) => {
    if (next === commands) return;
    commands = next;
    options.onCommands?.(commands);
  };
  const setAttempt = (next: AttemptState) => {
    if (next === attempt) return;
    attempt = next;
    options.onAttempt?.(attempt);
  };
  return {
    get view() { return view; },
    get commands() { return commands; },
    get attempt() { return attempt; },
    overdue(at = now()) {
      for (const sentAt of unacked.values()) if (at - sentAt >= ACK_TIMEOUT_MS) return true;
      return false;
    },
    watch(itemId) {
      if (itemId === attempt.watching) return;
      setAttempt({ ...attempt, watching: itemId });
      options.send(JSON.stringify(watchMessage(itemId)));
    },
    opened() {
      // The hello on a new socket already asks for a snapshot when the view needs one.
      resyncRequested = view.needsResync;
      hello(helloFor(view));
      // Commands still in flight go again with the same commandId; the edge dedupes.
      unacked.clear();
      for (const command of commandsToResend(commands)) sendCommand(command);
      // The edge keeps watches per socket: a new socket starts watching nothing.
      if (attempt.watching !== null) options.send(JSON.stringify(watchMessage(attempt.watching)));
    },
    send(input, label, confirm) {
      const command = { type: "command", commandId: newCommandId(), ...input, ...(confirm ? { confirm } : {}) } as ClientCommand;
      setCommands(reduceCommands(commands, { type: "sent", command, label }));
      sendCommand(command);
      return command.commandId;
    },
    received(data) {
      const message = parseEdgeMessage(data);
      if (!message) {
        // Command status and attempt messages are not EdgeMessages: they never touch the view.
        const live = parseAttemptMessage(data);
        if (live) {
          setAttempt(reduceAttempt(attempt, live));
          return true;
        }
        const status = parseCommandStatus(data);
        if (!status) return false;
        unacked.delete(status.commandId);
        setCommands(reduceCommands(commands, status));
        return true;
      }
      view = reduce(view, message);
      if (!view.needsResync) resyncRequested = false;
      else if (!resyncRequested) {
        resyncRequested = true;
        hello({ type: "hello", cursor: null, epoch: null });
      }
      options.onView?.(view);
      return true;
    },
  };
}
