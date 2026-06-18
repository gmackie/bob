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
 * On success the Effect resolves with the handler's return value.
 * On failure any `TRPCError` is mapped to the corresponding Bob tagged
 * error via `mapTrpcError`; unknown errors become `BobConflictError`.
 */
export function wrapHandler<I, O>(
  fn: (ctx: HandlerContext, input: I) => Promise<O>,
  ctx: HandlerContext,
  input: I,
  entityName = "unknown",
) {
  return Effect.tryPromise({
    try: () => fn(ctx, input),
    catch: (error) => {
      if (error instanceof TRPCError) {
        if (error.code === "NOT_FOUND") {
          return mapTrpcError("NOT_FOUND", {
            entity: entityName,
            id: "unknown",
          });
        }
        return mapTrpcError(error.code, { message: error.message });
      }
      return mapTrpcError("INTERNAL_SERVER_ERROR", { message: String(error) });
    },
  });
}
