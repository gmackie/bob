/**
 * When a handler fails with something the RPC contract does not declare, the
 * cause must survive to the client.
 *
 * `wrapHandler` mapped every unknown error to `BobConflictError`. Most Rpc
 * definitions declare no error at all (`ProjectsListRpc` is `payload` +
 * `success` only), so its error channel is just the middleware's
 * `UnauthorizedError | TenantNotSelectedError`. Encoding a `BobConflictError`
 * into that channel is impossible, so the server died with:
 *
 *   Expected UnauthorizedError | TenantNotSelectedError,
 *   got BobConflictError({"_tag":"BobConflictError"})
 *
 * — and the ACTUAL failure was erased. On 2026-08-30 that is what stood
 * between a blank workspaces list and a diagnosable error.
 *
 * A defect is not subject to the declared error channel, so dying with the
 * real message gets it to the client instead of replacing it with a tag that
 * says nothing. Declared errors (mapped TRPCErrors) keep failing normally.
 */
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { TRPCError } from "@trpc/server";

import { wrapHandler } from "../bridge.js";

const ctx = { db: {}, userId: "u1" } as never;

describe("wrapHandler unknown errors", () => {
  it("carries the real message through as a defect", async () => {
    const boom = new Error("connect ECONNREFUSED 10.0.0.1:5432");
    const exit = await Effect.runPromiseExit(
      wrapHandler(() => Promise.reject(boom), ctx, undefined, "project"),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // A DEFECT, not a typed failure: the declared error channel of most Rpcs
      // cannot carry a Bob error, so a typed failure here is unencodable and
      // the cause is lost. A defect bypasses the channel and keeps the message.
      const reasons = exit.cause.reasons;
      const die = reasons.find((r) => Cause.isDieReason(r));
      expect(die).toBeDefined();
      // Error fields are non-enumerable, so read the message directly rather
      // than stringifying — that is exactly how the server serialises it.
      expect(String((die as { defect?: unknown }).defect)).toContain("ECONNREFUSED");
    }
  });

  it("still maps a TRPCError to its declared tagged error", async () => {
    // These ARE declared by the contracts, so they must stay typed failures.
    const exit = await Effect.runPromiseExit(
      wrapHandler(
        () => Promise.reject(new TRPCError({ code: "NOT_FOUND", message: "nope" })),
        ctx,
        undefined,
        "project",
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const reasons = exit.cause.reasons;
      expect(reasons.some((r) => Cause.isFailReason(r))).toBe(true);
    }
  });

  it("passes a success through untouched", async () => {
    await expect(
      Effect.runPromise(wrapHandler(() => Promise.resolve({ ok: 1 }), ctx, undefined)),
    ).resolves.toEqual({ ok: 1 });
  });
});
