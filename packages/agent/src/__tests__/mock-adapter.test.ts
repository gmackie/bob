import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";

import {
  AdapterExitError,
  AdapterSpawnError,
  type AgentEvent,
} from "../adapter.js";
import { mockAdapter } from "../mock-adapter.js";

describe("@gmacko/agent MockAdapter", () => {
  it.effect("emits scripted events in order via Stream.runCollect", () =>
    Effect.gen(function* () {
      const scripted: readonly AgentEvent[] = [
        { type: "turn_start" },
        { type: "text_delta", text: "Hi" },
        { type: "turn_end", stopReason: "end_turn" },
      ];
      const adapter = mockAdapter({ events: scripted });

      const collected = yield* Effect.scoped(
        Effect.gen(function* () {
          const stream = yield* adapter.sendTurn({ prompt: "test" });
          return yield* Stream.runCollect(stream);
        }),
      );

      expect(Array.from(collected)).toEqual([
        { type: "turn_start" },
        { type: "text_delta", text: "Hi" },
        { type: "turn_end", stopReason: "end_turn" },
      ]);
    }),
  );

  it.effect("fails with AdapterSpawnError when failSpawn=true", () =>
    Effect.gen(function* () {
      const adapter = mockAdapter({ events: [], failSpawn: true });

      const caught = yield* Effect.scoped(
        adapter.sendTurn({ prompt: "test" }),
      ).pipe(
        Effect.catchTag("AdapterSpawnError", (err) => Effect.succeed(err)),
      );

      expect(caught).toBeInstanceOf(AdapterSpawnError);
      expect((caught as AdapterSpawnError).adapterId).toBe("mock");
      expect((caught as AdapterSpawnError).message).toContain("failSpawn");
    }),
  );

  it.effect(
    "fails the stream with AdapterExitError after scripted events when exitCode !== 0",
    () =>
      Effect.gen(function* () {
        const adapter = mockAdapter({
          events: [
            { type: "turn_start" },
            { type: "turn_end", stopReason: "end_turn" },
          ],
          exitCode: 1,
          stderr: "boom",
        });

        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const stream = yield* adapter.sendTurn({ prompt: "test" });
            // Capture events until the stream errors out; `catchAll` on a
            // stream converts an error into a terminal success value we can
            // observe alongside the already-emitted events.
            const merged = stream.pipe(
              Stream.map(
                (evt) => ({ kind: "event" as const, evt }) as const,
              ),
              Stream.catchTag("AdapterExitError", (err) =>
                Stream.succeed({ kind: "error" as const, err } as const),
              ),
            );
            return yield* Stream.runCollect(merged);
          }),
        );

        const chunks = Array.from(result);
        const events = chunks.filter(
          (c): c is { kind: "event"; evt: AgentEvent } => c.kind === "event",
        );
        const errors = chunks.filter(
          (c): c is { kind: "error"; err: AdapterExitError } =>
            c.kind === "error",
        );

        expect(events.map((e) => e.evt)).toEqual([
          { type: "turn_start" },
          { type: "turn_end", stopReason: "end_turn" },
        ]);
        expect(errors).toHaveLength(1);
        expect(errors[0]!.err).toBeInstanceOf(AdapterExitError);
        expect(errors[0]!.err.adapterId).toBe("mock");
        expect(errors[0]!.err.code).toBe(1);
        expect(errors[0]!.err.stderr).toBe("boom");
      }),
  );
});
