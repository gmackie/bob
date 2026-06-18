import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  and,
  arrayOverlaps,
  desc,
  eq,
  ilike,
  or,
} from "@gmacko/ooda/db";
import { researchThread, threadMemory } from "@gmacko/ooda/db/schema";

import { SearchThreadMemoryResponse } from "../../clients/sidecar-schemas";
import {
  vaultScopedAuthedProcedure,
  vaultScopedProcedure,
} from "../../middleware/vault-scope";

export const memoryRouter = {
  // --- Thread memory surface -------------------------------------------
  //
  // Reads + writes on `public.thread_memory`, the per-thread rolling
  // summary store. V1.5 search is deliberately text-only: the synergy
  // tick hasn't been given a real embedder yet (see `schedulers/cli.py`
  // placeholder), so cosine-similarity across `embedding` would return
  // 0.0 for every row. An ILIKE match on `rolling_summary_md` + an
  // array-overlap check on `topic_fingerprint` is a reasonable stand-in
  // until the embedder lands.

  /**
   * Substring / topic search across thread memories. `scope` controls
   * which threads we search:
   *   - "this" — only the caller's thread (requires ctx.threadId-ish;
   *     the tool layer passes the current thread via the `threadId`
   *     field so we can filter here).
   *   - "all" — every thread that has a memory row.
   *   - "research_vault" — same as "all" today (there's no
   *     per-vault split on `thread_memory` yet; the column will
   *     land alongside multi-user support).
   */
  threadMemorySearch: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/memory/search", tags: ["research.memory"] } })
    .input(
      z.object({
        query: z.string().min(1),
        scope: z.enum(["this", "all", "research_vault"]).default("all"),
        threadId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const { query, scope, threadId, limit } = input;

      if (scope === "this" && !threadId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "scope='this' requires threadId — the caller must pass the " +
            "current thread's id.",
        });
      }

      // Try semantic search via research-backend
      const apiUrl = process.env.RESEARCH_API_URL;
      if (apiUrl) {
        try {
          const params = new URLSearchParams({
            query,
            limit: String(limit),
          });
          if (scope === "this" && threadId) params.set("thread_id", threadId);

          const res = await fetch(
            `${apiUrl.replace(/\/+$/, "")}/api/search/thread-memory?${params}`,
          );
          if (res.ok) {
            const data = SearchThreadMemoryResponse.parse(await res.json());
            if (!data.fallback) {
              return {
                threads: data.threads.map((t) => ({
                  threadId: t.thread_id,
                  title: t.title,
                  rollingSummaryMd: t.rolling_summary_md ?? "",
                  topics: t.topic_fingerprint ?? [],
                  score: t.score,
                  updatedAt: t.updated_at,
                })),
              };
            }
          }
        } catch {
          // Fall through to ILIKE
        }
      }

      // Fallback: ILIKE text search
      const pattern = `%${query}%`;
      const queryTokens = query
        .split(/\s+/)
        .filter((t) => t.length > 0);

      const conditions = [
        or(
          ilike(threadMemory.rollingSummaryMd, pattern),
          queryTokens.length > 0
            ? arrayOverlaps(threadMemory.topicFingerprint, queryTokens)
            : undefined,
        ),
      ];
      if (scope === "this" && threadId) {
        conditions.push(eq(threadMemory.threadId, threadId));
      }

      const rows = await ctx.db
        .select({
          threadId: threadMemory.threadId,
          title: researchThread.title,
          rollingSummaryMd: threadMemory.rollingSummaryMd,
          topicFingerprint: threadMemory.topicFingerprint,
          updatedAt: threadMemory.updatedAt,
        })
        .from(threadMemory)
        .leftJoin(
          researchThread,
          eq(researchThread.id, threadMemory.threadId),
        )
        .where(and(...conditions))
        .orderBy(desc(threadMemory.updatedAt))
        .limit(limit);

      return {
        threads: rows.map((r) => ({
          threadId: r.threadId,
          title: r.title ?? null,
          rollingSummaryMd: r.rollingSummaryMd ?? "",
          topics: r.topicFingerprint ?? [],
          score: 1.0,
          updatedAt: r.updatedAt,
        })),
      };
    }),

  /**
   * Upsert a thread's rolling memory. Agents call this at turn end so
   * the nightly `thread_synergy` tick has fresh data. Writes
   * `rolling_summary_md`, `topic_fingerprint`, and stamps
   * `updated_at = now()`. Leaves `embedding` + `embedding_model` NULL
   * so the future placeholder-re-embed sweep picks up agent-authored
   * memories alongside scheduler-authored ones.
   */
  threadMemoryUpdate: vaultScopedAuthedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/memory/update", tags: ["research.memory"], protect: true } })
    .input(
      z.object({
        threadId: z.string().uuid(),
        summaryMd: z.string().min(1),
        topics: z.array(z.string()).max(64).default([]),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const { threadId, summaryMd, topics } = input;

      // INSERT ... ON CONFLICT on the thread_id PK so callers don't
      // have to care whether a row already exists.
      await ctx.db
        .insert(threadMemory)
        .values({
          threadId,
          rollingSummaryMd: summaryMd,
          topicFingerprint: topics,
          turnsSinceUpdate: 0,
        })
        .onConflictDoUpdate({
          target: threadMemory.threadId,
          set: {
            rollingSummaryMd: summaryMd,
            topicFingerprint: topics,
            turnsSinceUpdate: 0,
            updatedAt: new Date(),
          },
        });

      return { threadId, updatedAt: new Date() };
    }),
} satisfies RouterRecord;
