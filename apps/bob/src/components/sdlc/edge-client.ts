// The SDLC edge client's logic without a socket or React, so node tests cover it.
// use-sdlc-edge.ts wires it to a browser WebSocket.
import { emptyView, reduce, type EdgeMessage, type EdgeView } from "@bob/sdlc-view";

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
/** Capped exponential backoff: 1 s, 2 s, 4 s ... 30 s. */
export const reconnectDelay = (attempt: number) => Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));

export interface EdgeClient {
  readonly view: EdgeView;
  /** The socket opened: say hello. */
  opened(): void;
  /** One socket message: fold it into the view, and ask once for a snapshot after a seq gap. */
  received(data: unknown): void;
}

/**
 * Keeps the view across reconnects. When a delta leaves the view with needsResync set,
 * it sends one hello with cursor null on the open socket; the edge answers with a
 * snapshot, which clears needsResync. It asks again only after that, or on a new socket.
 */
export function createEdgeClient(options: { send: (data: string) => void; onView?: (view: EdgeView) => void; initial?: EdgeView }): EdgeClient {
  let view = options.initial ?? emptyView();
  let resyncRequested = false;
  const hello = (message: HelloMessage) => options.send(JSON.stringify(message));
  return {
    get view() { return view; },
    opened() {
      // The hello on a new socket already asks for a snapshot when the view needs one.
      resyncRequested = view.needsResync;
      hello(helloFor(view));
    },
    received(data) {
      const message = parseEdgeMessage(data);
      if (!message) return;
      view = reduce(view, message);
      if (!view.needsResync) resyncRequested = false;
      else if (!resyncRequested) {
        resyncRequested = true;
        hello({ type: "hello", cursor: null, epoch: null });
      }
      options.onView?.(view);
    },
  };
}
