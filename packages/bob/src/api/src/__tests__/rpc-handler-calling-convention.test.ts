/**
 * Pins how Effect RPC invokes a handler.
 *
 * Effect's own type is the contract:
 *
 *   type ToHandlerFn<Current, R> =
 *     (payload: Payload<Current>, options: {...}) => ...
 *
 * The payload arrives as the FIRST ARGUMENT, not wrapped in an object. Bob's
 * rpc-handlers are written as `({ payload }) => ...`, so `liftHandlers` has to
 * do the wrapping. When it doesn't:
 *
 *   - a `Schema.Void` payload arrives as `undefined`, and destructuring
 *     `{ payload }` from it throws `TypeError: Cannot destructure property
 *     'payload' of 'undefined'`. The server answers HTTP 200 with a Defect
 *     body, so the UI renders empty with nothing logged.
 *   - a real payload arrives as the object itself, so `payload` destructures
 *     to `undefined` and the handler runs on nothing.
 *
 * That shipped: on 2026-08-30 the entire settings page was blank and API key
 * creation failed, because every RPC procedure crashed this way. Nothing
 * caught it — rpc-layers.test.ts checks only that handler KEYS exist, and each
 * `toLayer` call is cast `as unknown as Parameters<...>`, which erases the
 * signature TypeScript would otherwise have rejected.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { Effect, ServiceMap } from "effect";

import { CurrentUser } from "@gmacko/core/rpc/context";
import { GmackoDb } from "@gmacko/core/db";

import { liftHandlers } from "../rpc-server.js";

/** Run a lifted handler with the two services it reads per-request. */
function run<A>(effect: Effect.Effect<A, unknown, unknown>) {
  const services = ServiceMap.empty().pipe(
    ServiceMap.add(GmackoDb, {} as never),
    ServiceMap.add(CurrentUser, { userId: "user-1" } as never),
  );
  return Effect.runPromise(
    (effect as Effect.Effect<A, unknown, never>).pipe(
      Effect.provideServices(services),
    ),
  );
}

describe("RPC handler calling convention", () => {
  it("hands the handler `{ payload }` when Effect passes the payload directly", async () => {
    const seen: unknown[] = [];
    const lifted = liftHandlers(() => ({
      "settings.updatePreferences": (input: never) => {
        seen.push(input);
        return Effect.succeed("ok");
      },
    }));

    // Exactly how Effect calls it: payload first, options second.
    await run(
      (lifted["settings.updatePreferences"] as unknown as (p: unknown, o: unknown) => Effect.Effect<unknown, unknown, unknown>)(
        { theme: "dark" },
        { clientId: 1, requestId: "r1", headers: {}, rpc: {} },
      ),
    );

    expect(seen).toEqual([{ payload: { theme: "dark" } }]);
  });

  it("survives a Schema.Void payload, which Effect passes as undefined", async () => {
    // The exact 2026-08-30 crash: `settings.listApiKeys` takes no payload, so
    // Effect calls the handler with `undefined`.
    const seen: unknown[] = [];
    const lifted = liftHandlers(() => ({
      "settings.listApiKeys": (input: never) => {
        // Destructuring here is what threw in production.
        const { payload } = input as unknown as { payload: unknown };
        seen.push(payload);
        return Effect.succeed([]);
      },
    }));

    await expect(
      run(
        (lifted["settings.listApiKeys"] as unknown as (p: unknown, o: unknown) => Effect.Effect<unknown, unknown, unknown>)(
          undefined,
          { clientId: 1, requestId: "r2", headers: {}, rpc: {} },
        ),
      ),
    ).resolves.toEqual([]);

    expect(seen).toEqual([undefined]);
  });
});
