import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { and, desc, eq, gt } from "@gmacko/ooda/db";
import { toolCallLog } from "@gmacko/ooda/db/schema";

import { publicProcedure, authedProcedure } from "../../trpc";

export const toolsRouter = {
  /**
   * Recent tool invocations for the live feed. Ordered newest first with
   * a computed `durationMs` (null while the call is still in flight).
   *
   * `since` trims to a tail window so the dashboard can poll / backfill
   * without re-fetching the full history each time.
   */
  toolLogsByThread: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/tools/logs", tags: ["research.tools"] } })
    .input(
      z.object({
        threadId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
        since: z.date().optional(),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(toolCallLog.threadId, input.threadId)];
      if (input.since) {
        conditions.push(gt(toolCallLog.startedAt, input.since));
      }

      const rows = await ctx.db
        .select({
          id: toolCallLog.id,
          toolName: toolCallLog.toolName,
          args: toolCallLog.args,
          resultSummary: toolCallLog.resultSummary,
          startedAt: toolCallLog.startedAt,
          finishedAt: toolCallLog.finishedAt,
          error: toolCallLog.error,
        })
        .from(toolCallLog)
        .where(and(...conditions))
        .orderBy(desc(toolCallLog.startedAt))
        .limit(input.limit);

      return {
        items: rows.map((r) => ({
          id: r.id,
          toolName: r.toolName,
          args: r.args,
          resultSummary: r.resultSummary ?? null,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt ?? null,
          error: r.error ?? null,
          durationMs:
            r.startedAt && r.finishedAt
              ? r.finishedAt.getTime() - r.startedAt.getTime()
              : null,
        })),
      };
    }),

  // --- Task 5.4: tool_call_log write procedures ------------------------
  //
  // The buddy-tools `withLogging` middleware inserts a row on tool entry
  // and updates it on exit. These procedures are the write surface for
  // that middleware — they're kept narrow (insert + finish only) because
  // nothing else should be writing to `tool_call_log`.

  /**
   * Insert a new tool_call_log row for a tool invocation about to start.
   * Returns the generated row id so the caller can pass it back to
   * `toolCallLogFinish` on completion.
   *
   * `startedAt` is populated server-side via the column default.
   */
  toolCallLogInsert: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/tools/insert", tags: ["research.tools"], protect: true } })
    .input(
      z.object({
        threadId: z.string().uuid(),
        runnerSessionId: z.string().uuid().optional(),
        toolName: z.string().min(1),
        args: z.unknown().optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .insert(toolCallLog)
        .values({
          threadId: input.threadId,
          runnerSessionId: input.runnerSessionId ?? null,
          toolName: input.toolName,
          args: input.args ?? null,
        })
        .returning({ id: toolCallLog.id });
      return { id: rows[0]!.id };
    }),

  /**
   * Finalize a tool_call_log row. Sets `finishedAt = now()` plus either
   * `resultSummary` (on success) or `error` (on failure). The middleware
   * never calls this with both populated.
   */
  toolCallLogFinish: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/tools/finish", tags: ["research.tools"], protect: true } })
    .input(
      z.object({
        id: z.string().uuid(),
        resultSummary: z.string().nullable().optional(),
        error: z.string().nullable().optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(toolCallLog)
        .set({
          finishedAt: new Date(),
          resultSummary: input.resultSummary ?? null,
          error: input.error ?? null,
        })
        .where(eq(toolCallLog.id, input.id))
        .returning({ id: toolCallLog.id });
      if (updated.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `tool_call_log row ${input.id} not found`,
        });
      }
      return { ok: true as const };
    }),
} satisfies RouterRecord;
