import { Effect } from "effect";
import { TRPCError } from "@trpc/server";
import { NotFoundError, RpcError, UnauthorizedError } from "@gmacko/core/rpc/errors";
import type { HandlerContext } from "./context";

/** These core tags are declared by both affected wire contracts. Do not use
 * Bob-only errors here: the core RPC serializer cannot encode those tags. */
export function wrapAuthorizedHandler<I, O>(
  fn: (ctx: HandlerContext, input: I) => Promise<O>,
  ctx: HandlerContext,
  input: I,
  entity: string,
) {
  return Effect.tryPromise({
    try: () => fn(ctx, input),
    catch: (error) => {
      if (error instanceof TRPCError) {
        if (error.code === "NOT_FOUND") return new NotFoundError({ entity, id: "unknown" });
        if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED") return new UnauthorizedError({ message: error.message });
        return new RpcError({ message: error.message });
      }
      return new RpcError({ message: `${entity} operation failed` });
    },
  });
}
