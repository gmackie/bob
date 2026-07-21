// In-process buddy-tool dispatcher.
//
// This is the piece that turns a *named* tool call from an agent into an
// actual handler invocation. It is transport-agnostic on purpose: it takes
// the descriptors built by `createBuddyToolDescriptors` (each with its Zod
// schema + a middleware-wrapped, ctx-bound handler) and:
//
//   1. looks the tool up by name,
//   2. validates the raw args against the tool's Zod schema,
//   3. invokes the wrapped handler,
//   4. wraps the outcome in the buddy-tools `ToolResult` envelope.
//
// Every failure mode (unknown tool, bad args, handler throw, budget
// exhaustion) is turned into a structured `{ ok: false, error }` result —
// the dispatcher never throws, so one bad tool call can't crash the session.
//
// The ACP/MCP transport glue that feeds real agent requests into here lives
// in `grok-acp.ts` (`handleAgentRequest`).

import { ToolHandlerError, type ToolResult } from "@gmacko/ooda/buddy-tools";

import type { ToolDescriptor } from "./tool-registry";

/**
 * The descriptor's `handler` is declared as `ToolHandler<(args, ctx)>` for
 * symmetry with the raw registry handlers, but `createBuddyToolDescriptors`
 * binds the `HandlerContext` via closure — so at dispatch time it is invoked
 * with parsed args only. We narrow to that bound call shape here.
 */
type BoundToolHandler = (args: unknown) => Promise<unknown>;

/**
 * Dispatch a single named tool call against a set of descriptors.
 *
 * Always resolves (never rejects): success becomes `{ ok: true, data }`,
 * every failure becomes `{ ok: false, error: { code, message, retryable } }`.
 */
export async function dispatchBuddyTool(
  descriptors: readonly ToolDescriptor[],
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const descriptor = descriptors.find((d) => d.name === toolName);
  if (!descriptor) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `Unknown tool: ${toolName}`,
        retryable: false,
      },
    };
  }

  const parsed = descriptor.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_ARGS",
        message: formatZodError(parsed.error),
        retryable: false,
      },
    };
  }

  try {
    const invoke = descriptor.handler as unknown as BoundToolHandler;
    const data = await invoke(parsed.data);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ToolHandlerError) {
      // Structured handler errors (incl. BUDGET_EXHAUSTED) pass through
      // with their code + retry semantics intact.
      return {
        ok: false,
        error: { code: err.code, message: err.message, retryable: err.retryable },
      };
    }
    return {
      ok: false,
      error: {
        code: "HANDLER_ERROR",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      },
    };
  }
}

/** Flatten a Zod parse failure into a single agent-readable message. */
function formatZodError(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  const parts = error.issues.map((issue) => {
    const path = issue.path.map((p) => String(p)).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return parts.length > 0 ? parts.join("; ") : "invalid arguments";
}
