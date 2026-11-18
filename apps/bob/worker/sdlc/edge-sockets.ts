// The SdlcEdge Durable Object's logic that does not need the Workers runtime, so node
// tests can cover it with fakes. edge-do.ts only wires these to the DO's state.
import { MAX_WATCHED_ITEMS, type WatchMessage } from "@bob/sdlc-view";
import type { CommandSender, EdgeController, EdgeSocket, Hello } from "./controller";
import { isViewer } from "./routes";
import { parseBatch } from "./store";

/** The part of a hibernatable WebSocket the edge uses. The attachment survives hibernation. */
export interface AttachedSocket extends EdgeSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** A hello is a small JSON object; anything longer is ignored unread. */
export const MAX_HELLO_CHARS = 2048;
/**
 * The largest command is a ResolveInput: an answer of up to 16000 characters that is itself
 * JSON (encodeAnswers), escaped again inside the message. Anything longer is ignored unread.
 */
export const MAX_COMMAND_CHARS = 64 * 1024;

/**
 * What a socket's attachment holds, across hibernation: whether it said hello, the
 * Bob user id the route verified for its upgrade. (The command rate is per user, in SQLite.)
 */
export interface SocketAttachment {
  greeted?: boolean;
  userId?: string;
  /**
   * The one item a socket watched before BOB-94. Only read, from attachments written by
   * an older deploy; a watch now always writes `watches` and removes this.
   */
  watch?: string;
  /** The items whose attempt detail (tail, CI) this socket watches (BOB-80, BOB-94); at most MAX_WATCHED_ITEMS. */
  watches?: string[];
  /** The socket asked for shipped entries (BOB-95) and is sent each new one. */
  shipped?: boolean;
}

/** The items a socket watches, from either attachment form. */
export function watchesOf(attachment: SocketAttachment): string[] {
  if (Array.isArray(attachment.watches)) return attachment.watches.filter((id): id is string => typeof id === "string");
  return typeof attachment.watch === "string" ? [attachment.watch] : [];
}

export function readAttachment(socket: AttachedSocket): SocketAttachment {
  try {
    const value = socket.deserializeAttachment();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as SocketAttachment) : {};
  } catch {
    return {};
  }
}
const isGreeted = (socket: AttachedSocket) => readAttachment(socket).greeted === true;

/**
 * The sockets broadcasts go to: only those that have sent a valid hello. A socket that
 * has not said hello has no view to apply a delta to, and is not sent one.
 */
export function greetedSockets<T extends AttachedSocket>(sockets: T[]): T[] {
  return sockets.filter(isGreeted);
}

/** Parses a client's hello: `{type:"hello", cursor: number|null, epoch: string|null}`. Anything else is null. */
export function parseHello(message: string | ArrayBuffer): Hello | null {
  if (typeof message !== "string" || message.length > MAX_HELLO_CHARS) return null;
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { type, cursor, epoch } = value as Record<string, unknown>;
  if (type !== "hello") return null;
  const cursorOk = cursor === null || (Number.isSafeInteger(cursor) && (cursor as number) >= 0);
  const epochOk = epoch === null || typeof epoch === "string";
  return cursorOk && epochOk ? { cursor: cursor as number | null, epoch: epoch as string | null } : null;
}

type Log = (line: string) => void;
const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;

/**
 * Marks the socket greeted, so it receives broadcasts from now on, then has the
 * controller reply. hello() replies synchronously, so no broadcast can come between
 * the mark and the reply. Logs how large the reply was (sizes only, no contents),
 * to watch for snapshots that approach the WebSocket message limit.
 */
export function greet(controller: Pick<EdgeController, "hello">, socket: AttachedSocket, hello: Hello, log: Log = console.log): void {
  socket.serializeAttachment({ ...readAttachment(socket), greeted: true });
  const sizes: number[] = [];
  let first: string | null = null;
  controller.hello(
    {
      send(data: string) {
        first ??= (JSON.parse(data) as { type: string }).type;
        sizes.push(byteLength(data));
        socket.send(data);
      },
    },
    hello,
  );
  log(JSON.stringify({
    event: "sdlc_edge_hello",
    reply: first === "snapshot" ? "snapshot" : "deltas",
    messages: sizes.length,
    bytes: sizes.reduce((a, b) => a + b, 0),
    largestBytes: Math.max(0, ...sizes),
  }));
}

/**
 * A watch is `{type:"watch", itemId}` or `{type:"watch", itemIds}`; anything longer is
 * ignored unread. Room for MAX_WATCHED_ITEMS ids of up to 200 characters, escaped.
 */
export const MAX_WATCH_CHARS = 4096;
/** A multi watch listing more ids than this is ignored; up to it, ids past MAX_WATCHED_ITEMS are dropped. */
const MAX_LISTED_IDS = 4 * MAX_WATCHED_ITEMS;
const isItemId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

/**
 * Parses a client's WatchMessage: `{type:"watch", itemId: string|null}`, or (BOB-94)
 * `{type:"watch", itemIds: string[]}` with every id valid. Anything else is null.
 */
export function parseWatchMessage(message: string | ArrayBuffer): WatchMessage | null {
  if (typeof message !== "string" || message.length > MAX_WATCH_CHARS) return null;
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { type, itemId, itemIds } = value as Record<string, unknown>;
  if (type !== "watch") return null;
  if (itemIds !== undefined) {
    if (itemId !== undefined || !Array.isArray(itemIds) || itemIds.length > MAX_LISTED_IDS || !itemIds.every(isItemId)) return null;
    return { type: "watch", itemIds: [...itemIds] };
  }
  if (itemId === null) return { type: "watch", itemId: null };
  return isItemId(itemId) ? { type: "watch", itemId } : null;
}

/** The user id a new socket carries; set once, when the DO accepts the upgrade. */
export function attachUser(socket: AttachedSocket, userId: string | null): void {
  socket.serializeAttachment(userId ? { userId } : {});
}

/** A parsed `{type:"command", ...}` message (shape unchecked: the controller validates it), or null. */
export function parseCommandMessage(message: string | ArrayBuffer): unknown {
  if (typeof message !== "string" || message.length > MAX_COMMAND_CHARS) return null;
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "command" ? value : null;
}

/**
 * Runs a command message through the controller with the socket's user id (from its
 * attachment, never from the message), the viewer allow-list as it is now, and the
 * user's sliding one-minute limit, shared by all of their sockets and kept in SQLite.
 */
export function handleCommand(
  controller: Pick<EdgeController, "command" | "takeCommandSlot">,
  socket: AttachedSocket,
  raw: unknown,
  viewerIds: string | undefined,
  now: number,
): void {
  const attachment = readAttachment(socket);
  const userId = typeof attachment.userId === "string" && attachment.userId.length > 0 ? attachment.userId : null;
  const sender: CommandSender = {
    userId,
    viewer: userId !== null && isViewer(userId, viewerIds),
    take: () => userId !== null && controller.takeCommandSlot(userId, now),
  };
  controller.command(socket, raw, sender);
}

/**
 * The DO's answer to an ingest body: 400 unless it parses as a batch; 503 with a
 * generic body when storage fails (the exporter retries); otherwise the result.
 */
export function ingestResponse(controller: Pick<EdgeController, "ingest">, text: string, log: Log = console.error): Response {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return Response.json({ error: "invalid batch" }, { status: 400 }); }
  const batch = parseBatch(value);
  if (!batch) return Response.json({ error: "invalid batch" }, { status: 400 });
  try {
    return Response.json(controller.ingest(batch));
  } catch (error) {
    log(JSON.stringify({ event: "sdlc_edge_ingest_failed", kind: batch.kind, error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
