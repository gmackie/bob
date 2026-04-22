// ClaudeCodeCliAdapter — skeleton shipped in Phase 6E Task 5.
//
// This module exports:
//   - `buildArgs`: pure argv-array builder for a single `claude` invocation.
//     Tested exhaustively; stable ordering guarantees test-snapshot friendly.
//   - `claudeCodeAdapter`: factory returning an `AgentAdapter`. `sendTurn`
//     is stubbed until Tasks 6 (subprocess spawn) and 7 (Queue-based
//     streaming producer) land. The stub fails fast with `AdapterSpawnError`
//     so callers can type-check against the contract and get a loud runtime
//     signal if they accidentally invoke the incomplete adapter.
//
// Canonical CLI invocation (from the protocol research in the Phase 6E plan):
//
//   claude --bare -p <prompt> --output-format stream-json --no-session-persistence
//          [--resume <session-id>]
//          [--allowedTools <csv>]
//          [--append-system-prompt <text>]
//
// All values are passed as separate argv entries — no shell escaping is
// needed because the downstream spawn call (Task 6) will not go through a
// shell.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

import { Effect, type Scope } from "effect";

import type { AdapterTurnInput, AgentAdapter } from "./adapter.js";
import { AdapterSpawnError } from "./adapter.js";

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

// Drift note for Effect@4.0.0-beta.43:
//   - `Effect.async` is renamed to `Effect.callback` (see Effect.d.ts
//     ~line 1593: "This API replaces ... Effect.async"). We use
//     `Effect.callback` for bridging the child's `exit`/`error` events.

/**
 * Spawn a subprocess under an `Effect.acquireRelease` so its lifetime is
 * bound to the enclosing `Scope`. This is the subprocess primitive for
 * `claudeCodeAdapter`; Task 7 composes the stream producer around it.
 *
 * Acquire: `child_process.spawn(binary, args, { cwd, stdio, env })`.
 *   - If `spawn` throws synchronously (e.g. Node validator rejects an
 *     invalid `command`), the thrown error is mapped to
 *     `AdapterSpawnError`.
 *   - Note that ENOENT for a missing binary is NOT thrown synchronously on
 *     macOS/Linux; instead the returned `ChildProcess` emits an asynchronous
 *     `error` event. That async failure mode is Task 7's responsibility to
 *     observe from the stream consumer.
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
        // Already dead: fast path. `exitCode === null` means the child has
        // not yet exited; `killed` flips true after any successful kill()
        // call even if the child hasn't been reaped yet.
        if (child.exitCode !== null || child.killed) return;

        // Request graceful termination. `.kill()` may return false if the
        // pid is already invalid; we don't care — we'll observe the exit
        // (or timeout) below either way.
        try {
          child.kill("SIGTERM");
        } catch {
          // Ignore — process may already be gone between the guard and here.
        }

        // Wait (up to 500 ms) for the child to exit, then escalate if it
        // is still alive. We use `Effect.race` between:
        //   (a) a callback-based effect that resolves when the child emits
        //       `exit` or `error`, and
        //   (b) a 500 ms timeout that, on expiry, fires SIGKILL.
        //
        // `Effect.callback` is Effect 4's replacement for `Effect.async` —
        // see module header drift note. It also accepts a cleanup effect
        // (returned from register) which fires on interruption; we use it
        // to remove the event listeners if the timeout wins the race.
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
 * `claudeCodeAdapter` returns an `AgentAdapter` that, when fully wired in
 * Task 7, spawns `claude` (via `spawnClaudeCode`) and streams its
 * stream-json output as `AgentEvent`s. Until Task 7 wires the Queue-based
 * stream producer, `sendTurn` remains stubbed and fails fast so callers
 * type-check against the contract.
 */
export const claudeCodeAdapter = (
  _opts: ClaudeCodeAdapterOptions = {},
): AgentAdapter => ({
  adapterId: "claude-code",
  sendTurn: () =>
    Effect.fail(
      new AdapterSpawnError({
        adapterId: "claude-code",
        message: "claudeCodeAdapter.sendTurn not yet implemented (Task 7)",
      }),
    ),
});
