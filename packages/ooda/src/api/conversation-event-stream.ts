import type { ConversationEventV1 } from "../contracts/v1";
import { OodaKernelProblem } from "../kernel/problems";

export function resolveAfterSequence(request: Request): string {
  const header = request.headers.get("Last-Event-ID")?.trim();
  const query = new URL(request.url).searchParams.get("afterSequence")?.trim();
  const value = header || query || "0";
  if (!/^\d+$/.test(value)) {
    throw new OodaKernelProblem(
      "VALIDATION_FAILED",
      422,
      "Last-Event-ID or afterSequence must be a decimal sequence",
    );
  }
  return value;
}

export function encodeConversationEventSse(event: ConversationEventV1): string {
  return `id: ${event.sequence}\nevent: conversation_event\ndata: ${JSON.stringify(event)}\n\n`;
}

function heartbeat(): string {
  return `: heartbeat ${new Date().toISOString()}\n\n`;
}

export function createConversationEventStreamResponse(input: {
  request: Request;
  readEvents: (afterSequence: string) => Promise<ConversationEventV1[]>;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxDurationMs?: number;
}): Response {
  let afterSequence = resolveAfterSequence(input.request);
  const encoder = new TextEncoder();
  const pollIntervalMs = input.pollIntervalMs ?? 500;
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? 15_000;
  const maxDurationMs = input.maxDurationMs ?? 25_000;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let polling = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (closeTimer) clearTimeout(closeTimer);
        try {
          controller.close();
        } catch {
          // A disconnect may close the controller before the abort signal arrives.
        }
      };
      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const events = [...(await input.readEvents(afterSequence))].sort((left, right) =>
            BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1,
          );
          for (const event of events) {
            if (BigInt(event.sequence) <= BigInt(afterSequence)) continue;
            enqueue(encodeConversationEventSse(event));
            afterSequence = event.sequence;
          }
        } catch (error) {
          enqueue(
            `event: problem\ndata: ${JSON.stringify({
              version: "v1",
              type: "https://ooda.local/problems/stream-read-failed",
              title: "Conversation stream read failed",
              status: 500,
              code: "STREAM_READ_FAILED",
              detail: error instanceof Error ? error.message : String(error),
              correlationId: crypto.randomUUID(),
            })}\n\n`,
          );
        } finally {
          polling = false;
        }
      };

      enqueue(`retry: ${pollIntervalMs}\n\n`);
      void poll();
      pollTimer = setInterval(() => void poll(), pollIntervalMs);
      heartbeatTimer = setInterval(() => enqueue(heartbeat()), heartbeatIntervalMs);
      closeTimer = setTimeout(close, maxDurationMs);
      input.request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (closeTimer) clearTimeout(closeTimer);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
