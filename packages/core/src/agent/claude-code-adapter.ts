// ClaudeCodeCliAdapter — Phase 6E Tasks 5 + 6 + 7.
//
// This module exports:
//   - `buildArgs`: pure argv-array builder for a single `claude` invocation.
//     Tested exhaustively; stable ordering guarantees test-snapshot friendly.
//   - `spawnClaudeCode`: `Effect.acquireRelease` wrapper around
//     `node:child_process.spawn`. Scope-bound subprocess lifetime with
//     SIGTERM-then-SIGKILL release. (Task 6.)
//   - `emitAgentEventsFromChild`: Queue-based stream producer that bridges a
//     spawned child's stdout → `StreamJsonBuffer` → `Queue.bounded` →
//     `Stream<AgentEvent>`. Observes the child's exit to close the queue
//     cleanly (exit 0), map non-zero to `AdapterExitError`, or inject a
//     `{type:"canceled"}` marker on SIGINT (exit 130). (Task 7.)
//   - `claudeCodeAdapter`: factory returning an `AgentAdapter`. `sendTurn`
//     composes `spawnClaudeCode` + `emitAgentEventsFromChild`.
//
// Canonical CLI invocation (from the protocol research in the Phase 6E plan):
//
//   claude --bare -p <prompt> --output-format stream-json --no-session-persistence
//          [--resume <session-id>]
//          [--allowedTools <csv>]
//          [--append-system-prompt <text>]
//
// All values are passed as separate argv entries — no shell escaping is
// needed because the downstream spawn call will not go through a shell.
//
// Effect 4 drift notes relevant to this module:
//   - `Effect.async` is renamed to `Effect.callback` in beta.43.
//   - `Queue.shutdown` is abrupt — it drops buffered events and interrupts
//     consumers. The correct clean-end API is `Queue.end`, which requires
//     the queue error channel to include `Cause.Done`. `Stream.fromQueue`
//     filters `Done` out of the resulting stream's error channel via
//     `Exclude<E, Cause.Done>`, so consumers only see our typed adapter
//     errors. This file types queues as
//     `Queue<AgentEvent, AdapterError | Cause.Done>` accordingly.
//   - `Effect.forkDetach(effect, { startImmediately: true })` — the second
//     arg ensures the forked fiber starts before the current fiber yields,
//     so `Stream.fromQueue` consumers don't race an unstarted producer.
//   - Tests that observe real subprocess wall-clock events must use
//     `it.live`, not `it.effect` (TestClock would hang finalizers).
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

import { Effect, Queue, Stream, type Cause, type Scope } from "effect";

import type {
  AdapterError,
  AdapterTurnInput,
  AgentAdapter,
  AgentEvent,
} from "./adapter.js";
import { AdapterExitError, AdapterSpawnError } from "./adapter.js";
import { StreamJsonBuffer } from "./stream-json-parser.js";

export interface ClaudeCodeAdapterOptions {
  /** Path or name of the `claude` binary. Default: `"claude"`. */
  readonly binary?: string;
}

/**
 * Build the argv array for a single `claude` invocation. Order is not
 * semantically meaningful to the CLI but we keep it stable for
 * test-snapshot friendliness: base flags first, then resume if set, then
 * allowedTools, then system-prompt.
 */
export function buildArgs(input: AdapterTurnInput): string[] {
  const args: string[] = [
    "--bare",
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--no-session-persistence",
  ];
  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.allowedTools && input.allowedTools.length > 0) {
    args.push("--allowedTools", input.allowedTools.join(","));
  }
  if (input.systemPrompt) {
    args.push("--append-system-prompt", input.systemPrompt);
  }
  return args;
}

/**
 * A running `claude` subprocess together with its adapter id. Returned from
 * `spawnClaudeCode`. The caller's `Scope` governs the process lifetime:
 * when the scope closes, the process is sent `SIGTERM`, escalated to
 * `SIGKILL` after a 500 ms grace period.
 */
export interface SpawnedChild {
  readonly process: ChildProcess;
  readonly adapterId: string;
}

/**
 * Spawn a subprocess under an `Effect.acquireRelease` so its lifetime is
 * bound to the enclosing `Scope`.
 *
 * Acquire: `child_process.spawn(binary, args, { cwd, stdio, env })`.
 *   - If `spawn` throws synchronously (e.g. Node validator rejects an
 *     invalid `command`), the thrown error is mapped to
 *     `AdapterSpawnError`.
 *   - ENOENT for a missing binary is NOT thrown synchronously on
 *     macOS/Linux; instead the returned `ChildProcess` emits an asynchronous
 *     `error` event. `emitAgentEventsFromChild` observes that path.
 *
 * Release: best-effort graceful shutdown.
 *   - If the child is already dead (exitCode !== null OR killed), no-op.
 *   - Otherwise send `SIGTERM` and race: wait for an `exit` (or `error`)
 *     event via `Effect.callback`, OR wait 500 ms then `SIGKILL`.
 */
export const spawnClaudeCode = (
  binary: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Effect.Effect<SpawnedChild, AdapterSpawnError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: (): SpawnedChild => {
        const child = nodeSpawn(binary, [...args], {
          cwd: options.cwd,
          env: options.env ?? process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { process: child, adapterId: "claude-code" };
      },
      catch: (err) =>
        new AdapterSpawnError({
          adapterId: "claude-code",
          message: err instanceof Error ? err.message : String(err),
        }),
    }),
    (spawned) =>
      Effect.gen(function* () {
        const child = spawned.process;
        if (child.exitCode !== null || child.killed) return;

        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore — process may already be gone between the guard and here.
        }

        const waitForExit = Effect.callback<void>((resume) => {
          const onDone = () => resume(Effect.void);
          child.once("exit", onDone);
          child.once("error", onDone);
          return Effect.sync(() => {
            child.removeListener("exit", onDone);
            child.removeListener("error", onDone);
          });
        });

        const escalate = Effect.sleep("500 millis").pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (child.exitCode === null && !child.killed) {
                try {
                  child.kill("SIGKILL");
                } catch {
                  // Process already gone — ignore.
                }
              }
            }),
          ),
        );

        yield* Effect.race(waitForExit, escalate);
      }),
  );

/**
 * Bridge a live `ChildProcess`'s stdout into a `Stream<AgentEvent>`.
 *
 * Design notes:
 *   - We use `StreamJsonBuffer` to handle arbitrary chunk boundaries from
 *     stdout — Node delivers bytes, not lines. The buffer accumulates
 *     partial lines and emits `AgentEvent`s on newline boundaries.
 *     (Alternative considered: `readline.createInterface` for built-in
 *     line splitting. We stuck with `StreamJsonBuffer` because it's our
 *     own primitive with 7 dedicated tests covering the chunking edge
 *     cases, including the flush-remaining-buffer-at-EOF case; pulling in
 *     `node:readline` would add an external dependency-surface without
 *     removing code.)
 *   - Emitter runs in a detached fiber (`forkDetach` + `startImmediately`),
 *     consistent with `mockAdapter`. The producer survives the outer
 *     `Effect.scoped` around `sendTurn` closing; the returned stream is
 *     what the caller reads from, and the scope that matters for the
 *     subprocess lifetime is held by `spawnClaudeCode`'s acquireRelease.
 *   - Non-Effect → Effect bridge: Node's `.on('data')` callback is
 *     synchronous and cannot `yield*` into the Effect runtime. We use
 *     `Effect.runPromise(Queue.offer(queue, evt))` to push events into the
 *     queue from the event handler. This is a pragmatic concession — for
 *     stream-json's line-by-line cadence (~one event per token, ~50ms
 *     apart) it's fine. Under hypothetical extreme throughput, offers
 *     racing against each other could land out of order; that is not a
 *     realistic regime for agent transcripts.
 *   - Exit policy:
 *       - code 0           → `Queue.end(queue)` (clean completion)
 *       - code 130 (SIGINT)→ inject `{type:"canceled"}` then `Queue.end`
 *       - other non-zero   → `Queue.fail(queue, AdapterExitError)`
 *   - Stderr is buffered in a closure-local array and attached to
 *     `AdapterExitError.stderr` on non-zero exit.
 */
export const emitAgentEventsFromChild = (
  child: ChildProcess,
  adapterId: string = "claude-code",
): Effect.Effect<Stream.Stream<AgentEvent, AdapterError>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.bounded<
      AgentEvent,
      AdapterError | Cause.Done
    >(256);

    // Stderr accumulator. The handler is attached synchronously at adapter
    // boot; if stderr is `null` (can happen if caller passes non-piped
    // stdio), we skip gracefully.
    const stderrChunks: string[] = [];
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(
        typeof chunk === "string" ? chunk : chunk.toString("utf8"),
      );
    });

    yield* Effect.forkDetach(
      Effect.gen(function* () {
        const buffer = new StreamJsonBuffer();

        // Phase 1: drain stdout until `end`. We set up both the `data`
        // and `end` listeners synchronously inside the callback register
        // to avoid missing an early `end` event. `end` resumes the
        // Effect.callback after flushing the buffer's tail. If stdout is
        // `null` we short-circuit immediately.
        yield* Effect.callback<void>((resume) => {
          const stdout = child.stdout;
          if (!stdout) {
            resume(Effect.void);
            return;
          }
          const onData = (chunk: Buffer | string) => {
            const text =
              typeof chunk === "string" ? chunk : chunk.toString("utf8");
            const events = buffer.push(text);
            for (const evt of events) {
              // Fire-and-forget offer. Queue is bounded(256) so under
              // heavy load this could drop events if the consumer never
              // reads — but the consumer is always a `Stream.fromQueue`
              // which will apply backpressure through the fiber scheduler.
              void Effect.runPromise(Queue.offer(queue, evt));
            }
          };
          const onEnd = () => {
            const tail = buffer.flush();
            for (const evt of tail) {
              void Effect.runPromise(Queue.offer(queue, evt));
            }
            resume(Effect.void);
          };
          stdout.on("data", onData);
          stdout.once("end", onEnd);
          return Effect.sync(() => {
            stdout.off("data", onData);
            stdout.off("end", onEnd);
          });
        });

        // Phase 2: await process exit (if not already exited) to decide
        // how to close the queue. `exitCode` already set on fast-exit
        // children — use that before registering a listener.
        const exitCode = yield* Effect.callback<number>((resume) => {
          if (child.exitCode !== null) {
            resume(Effect.succeed(child.exitCode));
            return;
          }
          // 'exit' fires when the child terminates, regardless of whether
          // stdio streams are closed. We default to 1 on `code === null`
          // (which happens if the child was killed by a signal and Node
          // reports signal instead of numeric code); in practice
          // `signalCode` would be set, but treating it as a non-zero
          // failure is the right policy for our exit-code-based
          // branching below.
          const onExit = (code: number | null) =>
            resume(Effect.succeed(code ?? 1));
          child.once("exit", onExit);
          return Effect.sync(() => {
            child.off("exit", onExit);
          });
        });

        if (exitCode === 0) {
          yield* Queue.end(queue);
        } else if (exitCode === 130) {
          // SIGINT — user-initiated cancellation. Inject the canceled
          // marker so transcript consumers can persist the cancellation
          // row, then end cleanly (not an error — cancellation is a
          // normal terminal state, not a failure).
          yield* Queue.offer(queue, {
            type: "canceled",
          });
          yield* Queue.end(queue);
        } else {
          yield* Queue.fail(
            queue,
            new AdapterExitError({
              adapterId,
              code: exitCode,
              stderr: stderrChunks.join(""),
            }),
          );
        }
      }),
      { startImmediately: true },
    );

    return Stream.fromQueue(queue);
  });

/**
 * `claudeCodeAdapter` returns an `AgentAdapter` that spawns `claude` via
 * `spawnClaudeCode` and streams its stream-json output as `AgentEvent`s via
 * `emitAgentEventsFromChild`. `sendTurn` is the trivial composition of the
 * two building blocks; each building block has its own dedicated test
 * suite.
 */
export const claudeCodeAdapter = (
  opts: ClaudeCodeAdapterOptions = {},
): AgentAdapter => {
  const binary = opts.binary ?? "claude";
  return {
    adapterId: "claude-code",
    sendTurn: (input: AdapterTurnInput) =>
      Effect.gen(function* () {
        const args = buildArgs(input);
        const spawned = yield* spawnClaudeCode(binary, args, {
          cwd: input.cwd,
        });
        return yield* emitAgentEventsFromChild(spawned.process, "claude-code");
      }),
  };
};
