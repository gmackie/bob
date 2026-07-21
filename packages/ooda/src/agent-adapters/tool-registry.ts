// Tool registration hook for ACP-exposed buddy tools.
//
// Status: LIVE on the Grok/ACP path. `GrokAdapter` implements
// `registerTools` — it stashes the descriptors built here and threads them
// into its ACP request handler (`handleAgentRequest`), where an in-process
// dispatcher (`tool-dispatcher.ts`) validates + runs the tool a live agent
// asks for mid-session.
//
// Still a no-op for the CLI-spawn adapters (`CodexAdapter`,
// `ClaudeAdapter`): they have no ACP tool channel, so their tool traffic
// originates inside their own prompts, not via this registry. `registerTools`
// safely no-ops for any adapter that doesn't implement the hook.

import {
  HANDLERS,
  TOOLS,
  TOOL_NAMES,
  withMiddleware,
  type BudgetState,
  type HandlerContext,
  type ToolHandler,
  type ToolName,
  type WithMiddlewareOptions,
} from "@gmacko/ooda/buddy-tools";
import type { z } from "zod";

import type { AgentAdapter } from "./types";

/**
 * Fully wired tool descriptor consumed by the ACP tool dispatcher
 * (`tool-dispatcher.ts`).
 *
 * `argsSchema` is the Zod schema the dispatcher validates with; we
 * re-use the one from `TOOLS[name].args` so there's a single source of
 * truth. `handler` is already middleware-wrapped (budget + logging) —
 * the dispatcher just invokes it with parsed args + the HandlerContext
 * it received on session start.
 */
export interface ToolDescriptor {
  name: ToolName;
  description: string;
  argsSchema: z.ZodTypeAny;
  handler: ToolHandler<ToolName>;
}

/**
 * Register tool descriptors on an adapter for the upcoming session. If the
 * adapter implements `registerTools` (Grok/ACP does), we hand it the list;
 * otherwise this is a no-op. Returns nothing — callers don't need a handle
 * back.
 *
 * No-op for CLI-spawn adapters: those have no ACP channel to push tool
 * schemas through, and their tool traffic goes through prompts instead.
 */
export function registerTools(
  adapter: AgentAdapter,
  tools: ToolDescriptor[],
): void {
  if (typeof adapter.registerTools === "function") {
    adapter.registerTools(tools);
  }
  // else: adapter does not support ACP tool registration yet. No-op.
}

export interface CreateBuddyToolDescriptorsOptions {
  /** Shared session budget threaded through every wrapped handler. */
  budget: BudgetState;
  /**
   * Whether to wrap with tool_call_log middleware. Default: true. Pass
   * `false` in unit tests that don't have a tRPC mock for
   * `toolCallLogInsert`/`toolCallLogFinish`.
   */
  logging?: boolean;
}

/**
 * Build one descriptor per `ToolName` from the buddy-tools registry.
 *
 * Each descriptor's handler is `withMiddleware`-wrapped in the standard
 * order (logging → budget → raw handler). The HandlerContext is held
 * via closure so the dispatcher doesn't re-thread it per call.
 *
 * This is the function ACP will consume when it lands: at session
 * start, build `ctx` + `budget`, call this, then pass the result to
 * `registerTools(adapter, ...)`.
 */
export function createBuddyToolDescriptors(
  ctx: HandlerContext,
  options: CreateBuddyToolDescriptorsOptions,
): ToolDescriptor[] {
  const { budget, logging = true } = options;

  return TOOL_NAMES.map((name) => {
    const rawHandler = HANDLERS[name];
    const middlewareOpts: WithMiddlewareOptions = { budget, logging };
    const wrapped = withMiddleware(name, rawHandler, middlewareOpts);

    // Close over `ctx` so the dispatcher doesn't need to thread it on
    // every call — it just invokes `descriptor.handler(args)`-adjacent.
    const handler: ToolHandler<ToolName> = (args) => wrapped(args, ctx);

    return {
      name,
      description: TOOLS[name].description,
      argsSchema: TOOLS[name].args,
      handler,
    };
  });
}
