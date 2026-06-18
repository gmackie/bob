// tool_call_log middleware: record every tool invocation to Postgres.
//
// On entry: INSERT a row via `research.toolCallLogInsert` with
// thread_id, runner_session_id, tool_name, args (started_at is filled
// by the column default).
//
// On exit: UPDATE via `research.toolCallLogFinish` with either
// result_summary (success) or error (failure). The handler's result
// value itself is passed through unchanged.
//
// Failure of the log write itself never propagates — we'd rather drop a
// log row than fail an otherwise-successful tool call because Postgres
// had a bad moment. Log-write errors go to `console.error` instead.

import { ToolHandlerError } from "../handler";
import type { ToolHandler } from "../handler";
import type { ToolName } from "../schemas";

const MAX_SUMMARY_LEN = 200;

/**
 * Build a short, single-line summary of a tool result for the log.
 * Prefer tool-specific summaries where the payload has an obvious
 * headline field (counts, ids); fall back to a truncated JSON snippet.
 */
export function summarize(toolName: ToolName, result: unknown): string {
  if (result === undefined || result === null) {
    return "";
  }
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    switch (toolName) {
      case "dive_spawn": {
        const id = typeof r.exploration_id === "string" ? r.exploration_id : "";
        const status = typeof r.status === "string" ? r.status : "";
        return `exploration_id=${id} status=${status}`;
      }
      case "dive_status": {
        const status = typeof r.status === "string" ? r.status : "";
        const visited =
          typeof r.papers_visited === "number" ? r.papers_visited : 0;
        return `status=${status} visited=${visited}`;
      }
      case "dive_results": {
        const n = Array.isArray(r.findings) ? r.findings.length : 0;
        return `findings=${n}`;
      }
      case "inbox_list":
      case "interest_list": {
        const n = Array.isArray(r.items) ? r.items.length : 0;
        return `items=${n}`;
      }
      case "inbox_triage": {
        const triage = typeof r.triage === "string" ? r.triage : "";
        return `triage=${triage}`;
      }
      case "interest_register": {
        const id = typeof r.id === "string" ? r.id : "";
        return `id=${id}`;
      }
      case "kb_promote_request": {
        const status = typeof r.status === "string" ? r.status : "";
        return `status=${status}`;
      }
      case "cp_open_url": {
        const n = Array.isArray(r.urls) ? r.urls.length : 0;
        return `urls=${n}`;
      }
    }
  }
  try {
    const s = JSON.stringify(result);
    return s.length > MAX_SUMMARY_LEN ? s.slice(0, MAX_SUMMARY_LEN) : s;
  } catch {
    return "";
  }
}

/**
 * Wrap a ToolHandler with tool_call_log INSERT/UPDATE bookkeeping.
 *
 * The tool name is passed in explicitly because handlers are plain
 * async functions — there's no reliable way to recover the name at
 * runtime — and because the per-tool summarizer keys off it.
 *
 * Errors (including `ToolHandlerError` thrown by `withBudget`) are
 * logged to the row's `error` column and then re-thrown so the
 * dispatcher can wrap them in the ToolResult envelope.
 */
export function withLogging<T extends ToolName>(
  toolName: T,
  handler: ToolHandler<T>,
): ToolHandler<T> {
  return async (args, ctx) => {
    let logId: string | null = null;
    try {
      const row = await ctx.trpc.research.toolCallLogInsert({
        threadId: ctx.threadId,
        ...(ctx.runnerSessionId !== undefined
          ? { runnerSessionId: ctx.runnerSessionId }
          : {}),
        toolName,
        args,
      });
      logId = row.id;
    } catch (err) {
      console.error("[buddy-tools] tool_call_log insert failed", err);
    }

    try {
      const result = await handler(args, ctx);
      if (logId !== null) {
        try {
          await ctx.trpc.research.toolCallLogFinish({
            id: logId,
            resultSummary: summarize(toolName, result),
            error: null,
          });
        } catch (err) {
          console.error("[buddy-tools] tool_call_log finish failed", err);
        }
      }
      return result;
    } catch (err) {
      if (logId !== null) {
        const errText =
          err instanceof ToolHandlerError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        try {
          await ctx.trpc.research.toolCallLogFinish({
            id: logId,
            resultSummary: null,
            error: errText,
          });
        } catch (logErr) {
          console.error(
            "[buddy-tools] tool_call_log finish (error path) failed",
            logErr,
          );
        }
      }
      throw err;
    }
  };
}
