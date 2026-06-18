// Task 7 — Queue-based stream producer bridging subprocess stdout to
// `Stream<AgentEvent>`. These tests exercise `emitAgentEventsFromChild`,
// the producer helper extracted from `sendTurn` so it can be tested
// directly against a scripted `node -e` subprocess without relying on the
// `claude`-specific argv layout built by `buildArgs`.
//
// Shape rationale (option (a) from the Task 7 brief):
//   - `sendTurn` composes `spawnClaudeCode` (argv built via `buildArgs`) +
//     `emitAgentEventsFromChild(child)`. The helper is the part worth
//     testing; the composition is trivial.
//   - Tests spawn `process.execPath` (node itself) directly via
//     `spawnClaudeCode`, running an inline `-e` script that prints scripted
//     NDJSON lines and exits with a chosen code. This hermetically covers
//     the producer's stdout → queue bridge + exit-code → queue-end policy
//     without needing a `claude` binary.
//
// Why `it.live` (NOT `it.effect`):
//   Subprocess exit events fire on the wall clock. `it.effect` installs
//   `TestClock`, so any `Effect.sleep` / timed operation inside finalizers
//   will hang because the test never adjusts the clock. `it.live` uses the
//   real clock. Task 6 hit the same thing — we mirror that pattern.
import { it } from "@effect/vitest";
import { Effect, Exit, Stream } from "effect";
import { describe, expect } from "vitest";

import {
  AdapterExitError,
  type AgentEvent,
} from "../adapter.js";
import {
  emitAgentEventsFromChild,
  spawnClaudeCode,
} from "../claude-code-adapter.js";

describe("ClaudeCodeCliAdapter — Queue-based stream producer (Task 7)", () => {
  it.live(
    "collects session_init → text_delta → turn_end from a scripted subprocess",
    () =>
      Effect.gen(function* () {
        // Inline node script that prints 3 scripted NDJSON lines and exits
        // cleanly. Matches the parser's expected shape for system/init,
        // stream_event+text_delta, and turn_end.
        const script = [
          `console.log(JSON.stringify({type:"system/init",session_id:"s1",model:"sonnet"}));`,
          `console.log(JSON.stringify({type:"stream_event",event:{delta:{type:"text_delta",text:"Hi"}}}));`,
          `console.log(JSON.stringify({type:"turn_end",stop_reason:"end_turn"}));`,
        ].join("");

        const collected = yield* Effect.scoped(
          Effect.gen(function* () {
            const spawned = yield* spawnClaudeCode(process.execPath, [
              "-e",
              script,
            ]);
            const stream = yield* emitAgentEventsFromChild(spawned.process);
            return yield* Stream.runCollect(stream);
          }),
        );

        const events = Array.from(collected) as readonly AgentEvent[];

        expect(events).toEqual([
          {
            type: "session_init",
            externalSessionId: "s1",
            model: "sonnet",
          },
          { type: "text_delta", text: "Hi" },
          { type: "turn_end", stopReason: "end_turn" },
        ]);
      }),
  );

  it.live(
    "non-zero subprocess exit maps to AdapterExitError on the stream",
    () =>
      Effect.gen(function* () {
        // Subprocess writes to stderr then exits with code 3. No NDJSON on
        // stdout. The producer should observe the non-zero exit, collect
        // the stderr text, and `Queue.fail(adapterExitError)` — surfaced on
        // the stream as a typed error via `Stream.fromQueue`.
        const script = `console.error("oops");process.exit(3);`;

        const exit = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const spawned = yield* spawnClaudeCode(process.execPath, [
                "-e",
                script,
              ]);
              const stream = yield* emitAgentEventsFromChild(spawned.process);
              return yield* Stream.runCollect(stream);
            }),
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const serialized = JSON.stringify(exit.cause);
          expect(serialized).toContain("AdapterExitError");
          // Also pull the raw error and assert code/stderr shape. Effect 4
          // tagged errors live at cause failures — walk the cause tree.
          // Defensive: we only need to prove the exit error shape; match
          // the serialized cause text for fields.
          expect(serialized).toContain("\"code\":3");
          expect(serialized).toContain("oops");
        }

        // Guard against accidental rename of the error class.
        expect(
          new AdapterExitError({
            adapterId: "claude-code",
            code: 3,
            stderr: "x",
          }),
        ).toBeInstanceOf(AdapterExitError);
      }),
  );
});
