// Stub handler scaffolding for tools whose backing tRPC procedures
// haven't landed yet.
//
// Empty in V1.5 now that the original six planned tools
// (papers_search, paper_get, graph_neighborhood, graph_path,
// thread_memory_search, thread_memory_update) all have real handlers.
// Kept so future tool schemas added to TOOLS_PLANNED in schemas.ts can
// re-use `notImplemented()` without rebuilding the structured-error
// shape.

import { ToolHandlerError } from "../handler";
import type { HandlerContext } from "../handler";
import type { AnyToolName } from "../schemas";

type PlannedHandler = (args: unknown, ctx: HandlerContext) => Promise<never>;

export function notImplemented(name: AnyToolName): PlannedHandler {
  return async () => {
    throw new ToolHandlerError(
      "NOT_IMPLEMENTED",
      `tool ${name} not implemented in V1.5`,
      { retryable: false },
    );
  };
}
