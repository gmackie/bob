import { eq } from "@gmacko/ooda/db";
import { sessionEvent } from "@gmacko/ooda/db/schema";

import { db } from "~/lib/db-client-lazy";

const POLL_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SessionEventRow = typeof sessionEvent.$inferSelect;

function encodeSse(event: string, data: unknown): string {
  const payload = JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

function encodeHeartbeat(): string {
  return `: heartbeat ${new Date().toISOString()}\n\n`;
}

async function readSessionEvents(sessionId: string): Promise<SessionEventRow[]> {
  return db.query.sessionEvent.findMany({
    where: eq(sessionEvent.sessionId, sessionId),
    orderBy: sessionEvent.createdAt,
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId || !uuidPattern.test(sessionId)) {
    return Response.json({ error: "A valid sessionId is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const seenEventIds = new Set<string>();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(chunk));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // The client may already have disconnected.
        }
      };

      const poll = async () => {
        try {
          const events = await readSessionEvents(sessionId);
          for (const event of events) {
            if (seenEventIds.has(event.id)) continue;
            seenEventIds.add(event.id);
            enqueue(
              encodeSse("session_output", {
                id: event.id,
                session_id: event.sessionId,
                type: event.type,
                created_at: event.createdAt.toISOString(),
              }),
            );

            if (event.type === "exit" || event.type === "error") {
              close();
              return;
            }
          }
        } catch (error) {
          enqueue(
            encodeSse("session_output_error", {
              session_id: sessionId,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      };

      for (const event of await readSessionEvents(sessionId)) {
        seenEventIds.add(event.id);
      }

      enqueue(encodeHeartbeat());
      pollTimer = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
      heartbeatTimer = setInterval(() => {
        enqueue(encodeHeartbeat());
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
