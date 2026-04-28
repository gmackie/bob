// Task 6 — ClaudeCodeCliAdapter subprocess lifecycle.
//
// These tests exercise `spawnClaudeCode`, the Effect.acquireRelease wrapper
// around `node:child_process.spawn` used by the ClaudeCodeCliAdapter. We
// deliberately do NOT spawn `claude` here — we spawn `node` itself (via
// `process.execPath`) so the tests are hermetic on macOS + Linux CI.
//
// Shape A (per Task 6 plan): `spawnClaudeCode` is a standalone, reusable
// Effect; Task 7 will wire it from inside `sendTurn`.
import type { ChildProcess } from "node:child_process";

import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { describe, expect } from "vitest";

import { AdapterSpawnError } from "../adapter.js";
import { spawnClaudeCode } from "../claude-code-adapter.js";

describe("ClaudeCodeCliAdapter — subprocess lifecycle (Task 6)", () => {
  // `it.live` (not `it.effect`) because this test spawns a real OS process
  // and drives its SIGTERM lifecycle through the wall clock. `it.effect`
  // installs `TestClock` — `Effect.sleep("500 millis")` inside the release
  // clause would then wait for `TestClock.adjust` and hang indefinitely
  // because the subprocess kill path runs in a finalizer, not under the
  // test's direct control.
  it.live(
    "subprocess receives SIGTERM on scope exit and reports killed=true",
    () =>
      Effect.gen(function* () {
        let childRef: ChildProcess | null = null;

        yield* Effect.scoped(
          Effect.gen(function* () {
            // Long-lived child: `setInterval` keeps the event loop alive so
            // the process doesn't exit on its own before the scope closes.
            const spawned = yield* spawnClaudeCode(
              process.execPath,
              ["-e", "setInterval(()=>{},1000);"],
            );
            childRef = spawned.process;
            expect(spawned.adapterId).toBe("claude-code");
            expect(typeof spawned.process.pid).toBe("number");
            // Still running inside the scope.
            expect(spawned.process.exitCode).toBeNull();
          }),
        );

        // Scope has exited; the release clause fired. Give the OS a short
        // window to deliver SIGTERM and have Node reap the child.
        yield* Effect.sleep("200 millis");
        expect(childRef).not.toBeNull();
        expect(childRef!.killed).toBe(true);
      }),
  );

  // NOTE on the "non-existent binary" case: `node:child_process.spawn` does
  // NOT throw synchronously for ENOENT on macOS / Linux — it returns a
  // ChildProcess handle that emits an `error` event asynchronously. So
  // `Effect.try` around `spawn(...)` will NOT catch that path.
  //
  // We chose option (b) from the plan: exercise a deterministic SYNC-throw
  // path by passing an empty string for the `command` argument, which Node's
  // validator rejects synchronously with TypeError [ERR_INVALID_ARG_VALUE].
  // This reliably proves the `Effect.try` catch clause converts sync throws
  // to `AdapterSpawnError`. Async `error`-event mapping is Task 7's concern
  // (it owns the stream producer that observes child events).
  it.effect(
    "synchronous spawn failure (invalid command) fails with AdapterSpawnError",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          Effect.scoped(spawnClaudeCode("", ["-p", "x"])),
        );

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          // Drill into the cause to assert the error _tag; the effect's
          // error channel is typed `AdapterSpawnError`.
          const cause = result.cause;
          // The most defensive check: stringify the cause and look for the
          // tag. Effect 4 tagged errors expose `_tag` on the raw error.
          const serialized = JSON.stringify(cause);
          expect(serialized).toContain("AdapterSpawnError");
        }

        // Also sanity-check the constructed error class exists & is used
        // somewhere in the module graph (guards against accidental rename).
        expect(new AdapterSpawnError({ adapterId: "claude-code", message: "x" }))
          .toBeInstanceOf(AdapterSpawnError);
      }),
  );
});
