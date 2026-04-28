import { Effect, Stream } from "effect";

/**
 * Convert a `Stream<A>` to a Server-Sent Events `Response`.
 *
 * Each event becomes one SSE message: `data: <encode(event)>\n\n`.
 * Stream completion closes the response. Stream failure aborts the underlying
 * `ReadableStream` controller with the failure cause.
 *
 * Used at HTTP route handler boundaries (Next.js Route Handlers, Bun.serve,
 * Hono, etc.) to push pubsub or agent-event streams to browser clients.
 * Pubsub consumers internally stay pure Effect/Stream — only convert to
 * `Response` at the boundary.
 *
 * Returns a synchronous `Response` for ergonomic use in route handlers that
 * generally aren't Effect-aware at the boundary. The caller is responsible
 * for providing a closed-over runtime / scope for the underlying stream.
 *
 * IMPORTANT: `Effect.runPromise(Stream.runForEach(...))` runs without a Scope,
 * so any scoped resources in the stream (e.g. a `PubSub.Subscription`) must
 * be wrapped in `Effect.scoped` (via `Stream.unwrapScoped` or similar) BEFORE
 * being passed to `streamToSseResponse`. Caller's responsibility.
 *
 * @param stream - The event stream to push.
 * @param encode - Per-event encoder, default `JSON.stringify`.
 */
export const streamToSseResponse = <A, E>(
  stream: Stream.Stream<A, E>,
  encode: (a: A) => string = JSON.stringify,
): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await Effect.runPromise(
          Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              const line = `data: ${encode(event)}\n\n`;
              controller.enqueue(encoder.encode(line));
            }),
          ),
        );
        controller.close();
      } catch (err) {
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
