/**
 * Bridge that wraps async handler functions into Effect values,
 * mapping TRPCError to Bob's tagged Effect errors.
 *
 * Phase 7B-4D Task 1.
 */
import { Effect } from "effect";
import { TRPCError } from "@trpc/server";
import { mapTrpcError } from "@gmacko/bob/contracts";

import type { HandlerContext } from "./context.js";

/**
 * Wraps an async handler function into an Effect value.
 *
 * On success the Effect resolves with the handler's return value. A
 * `TRPCError` is mapped to the corresponding Bob tagged error via
 * `mapTrpcError` — those are declared by the contracts, so they stay typed
 * failures.
 *
 * Anything else DIES rather than failing. Most Rpc definitions declare no
 * error at all (`ProjectsListRpc` is payload + success only), so their error
 * channel is just the middleware's `UnauthorizedError | TenantNotSelectedError`.
 * Mapping an unknown error to a Bob tagged error made it unencodable, and the
 * server answered with
 *
 *   Expected UnauthorizedError | TenantNotSelectedError,
 *   got BobConflictError({"_tag":"BobConflictError"})
 *
 * which erased the real cause. A defect is not subject to the declared
 * channel, so the actual message reaches the client and the failure is
 * diagnosable instead of anonymous.
 */
export function wrapHandler<I, O>(
  fn: (ctx: HandlerContext, input: I) => Promise<O>,
  ctx: HandlerContext,
  input: I,
  entityName = "unknown",
) {
  return Effect.tryPromise({
    try: () => fn(ctx, input),
    // Keep the raw error; the branch below decides fail-vs-die.
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      error instanceof TRPCError
        ? Effect.fail(
            error.code === "NOT_FOUND"
              ? mapTrpcError("NOT_FOUND", { entity: entityName, id: "unknown" })
              : mapTrpcError(error.code, { message: error.message }),
          )
        : // Undeclared by every contract — see the note above. A defect is not
          // subject to the declared error channel, so the real cause survives.
          Effect.die(
            error instanceof Error
              ? error
              : new Error(`${entityName}: ${String(error)}`),
          ),
    ),
  );
}
