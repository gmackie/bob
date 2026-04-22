// MockAdapter — in-memory, deterministic `AgentAdapter` implementation.
//
// Test harness used by Tasks 9, 10, 12 to exercise AgentSession without
// spawning subprocesses. No filesystem, no network, no child_process. The
// adapter emits a caller-supplied scripted event sequence through a
// `Queue.bounded` buffer and exposes it via `Stream.fromQueue`.
//
// Supported failure modes:
//   - `failSpawn: true`      → `sendTurn` fails immediately with
//                              `AdapterSpawnError` (no stream produced).
//   - `exitCode !== 0`       → all scripted events are emitted, then the
//                              stream fails with `AdapterExitError` carrying
//                              `{ code, stderr }`. Implemented via
//                              `Queue.fail(queue, error)` — verified in
//                              effect@4.0.0-beta.43 `Queue.d.ts:551`, which
//                              exposes `fail: <A, E>(Enqueue<A, E>, E) => Effect<boolean>`.
//                              Preferred over `Queue.failCause` + manual
//                              `Cause.fail(...)` because the raw-error API
//                              aligns with the queue's already-typed error
//                              channel.
//   - `perEventDelayMs > 0`  → `Effect.sleep` between emissions, useful for
//                              cancel-mid-stream tests in Task 12.
//
// Queue completion API choice (important Effect 4 drift note):
//   The Phase 6E plan mentions "Queue.shutdown signals end" — but in
//   effect@4.0.0-beta.43, `Queue.shutdown` is abrupt: it cancels pending
//   operations AND clears the queue. Using it here drops buffered events
//   and surfaces as "All fibers interrupted without error" from
//   `Stream.runCollect`. The correct clean-end API is `Queue.end` (defined
//   at Queue.d.ts:697): `end: <A, E>(self: Enqueue<A, E | Done>) => Effect<boolean>`.
//   `Queue.end` requires the error channel to include `Cause.Done`;
//   `Stream.fromQueue` is typed to `Exclude<E, Cause.Done>` so `Done` never
//   surfaces on the consumer's stream — only a clean end. We therefore
//   type the queue as `Queue<AgentEvent, AdapterError | Cause.Done>`.
//
// The emitter runs in a detached fiber (`Effect.forkDetach` with
// `startImmediately: true`) so `sendTurn` returns the consumer stream
// immediately and the emitter kicks off before the caller reads.
// `forkDetach` attaches the fiber to the global scope rather than the
// caller's scope — the emitter survives `Effect.scoped` closing around the
// outer `sendTurn` Effect, which is important because the returned stream
// is what the caller actually reads from.
import { Effect, Queue, Stream, type Cause } from "effect";

import {
  AdapterExitError,
  AdapterSpawnError,
  type AdapterError,
  type AgentAdapter,
  type AgentEvent,
} from "./adapter.js";

export interface MockAdapterScript {
  /** Events to emit, in order. */
  readonly events: readonly AgentEvent[];
  /**
   * If set, `sendTurn` fails with `AdapterSpawnError` before a stream is
   * produced. Useful for exercising the AgentSession error path.
   */
  readonly failSpawn?: boolean;
  /**
   * Simulated exit code. `0` = clean (queue shut down normally after all
   * events emit). Non-zero = the stream fails with `AdapterExitError`
   * after all scripted events have been offered. Default `0`.
   */
  readonly exitCode?: number;
  /**
   * Delay between successive `Queue.offer` calls, in milliseconds. Default
   * `0` (no sleep — events flush as fast as the queue can accept them).
   */
  readonly perEventDelayMs?: number;
  /**
   * Simulated stderr text, surfaced in `AdapterExitError.stderr` when
   * `exitCode !== 0`. Default `""`.
   */
  readonly stderr?: string;
}

export const mockAdapter = (script: MockAdapterScript): AgentAdapter => ({
  adapterId: "mock",
  sendTurn: () =>
    Effect.gen(function* () {
      if (script.failSpawn) {
        return yield* Effect.fail(
          new AdapterSpawnError({
            adapterId: "mock",
            message: "mock adapter: failSpawn=true",
          }),
        );
      }

      // Queue error channel is `AdapterError | Cause.Done` so we can call
      // `Queue.end(queue)` for clean completion. `Stream.fromQueue` strips
      // `Done` out of the surfaced error type via `Exclude<E, Cause.Done>`,
      // leaving `AdapterError` on the consumer-visible stream.
      const queue = yield* Queue.bounded<
        AgentEvent,
        AdapterError | Cause.Done
      >(256);
      const delayMs = script.perEventDelayMs ?? 0;
      const exit = script.exitCode ?? 0;
      const stderr = script.stderr ?? "";
      const events = script.events;

      // Detached emitter fiber. `startImmediately: true` ensures the fiber
      // kicks off before we hand the stream back to the caller, so
      // consumers using `Stream.runCollect` don't race against an unstarted
      // producer. `forkDetach` attaches to the global scope rather than the
      // caller's scope — the emitter survives `Effect.scoped` closing around
      // the outer `sendTurn` Effect, which is important because the returned
      // stream is what the caller actually reads from.
      yield* Effect.forkDetach(
        Effect.gen(function* () {
          for (const evt of events) {
            if (delayMs > 0) {
              yield* Effect.sleep(`${delayMs} millis`);
            }
            yield* Queue.offer(queue, evt);
          }
          if (exit !== 0) {
            // Queue.fail: Effect 4.0.0-beta.43 Queue.d.ts:551
            // `fail: <A, E>(self: Enqueue<A, E>, error: E) => Effect<boolean>`
            // Signals end-of-stream with a typed error; Stream.fromQueue
            // surfaces this on the stream's error channel.
            yield* Queue.fail(
              queue,
              new AdapterExitError({
                adapterId: "mock",
                code: exit,
                stderr,
              }),
            );
          } else {
            // Queue.end: signals clean end-of-stream. Requires the queue's
            // error type to include `Cause.Done`; `Stream.fromQueue`
            // filters `Done` out of its error channel automatically so the
            // consumer sees a clean stream completion, not an error.
            yield* Queue.end(queue);
          }
        }),
        { startImmediately: true },
      );

      return Stream.fromQueue(queue);
    }),
});
