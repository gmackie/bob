// The SdlcEdge Durable Object's logic that does not need the Workers runtime, so node
// tests can cover it with fakes. edge-do.ts only wires these to the DO's state.
import type { EdgeController, EdgeSocket, Hello } from "./controller";
import { parseBatch } from "./store";

/** The part of a hibernatable WebSocket the edge uses. The attachment survives hibernation. */
export interface AttachedSocket extends EdgeSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** A hello is a small JSON object; anything longer is ignored unread. */
export const MAX_HELLO_CHARS = 2048;

const isGreeted = (socket: AttachedSocket) => {
  try {
    const attachment = socket.deserializeAttachment() as { greeted?: unknown } | null;
    return attachment?.greeted === true;
  } catch {
    return false;
  }
};

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
  socket.serializeAttachment({ greeted: true });
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
