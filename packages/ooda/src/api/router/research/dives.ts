import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  and,
  desc,
  gte,
  inArray,
  isNull,
  or,
} from "@gmacko/ooda/db";
import { graphExploration } from "@gmacko/ooda/db/schema";

import { vaultScopedProcedure } from "../../middleware/vault-scope";
import { publicProcedure, authedProcedure } from "../../trpc";
import { DiveSpawnInput, getBackendClient } from "./_helpers";

export const divesRouter = {
  // Task 4.1: research.dive* — front the research-backend REST endpoints
  // at /dives, /dives/{id}, /dives/{id}/results. Flat camelCase per
  // CLAUDE.md tRPC naming convention.
  //
  // Vault scoping: V1.5 is research-vault-only (research-backend owns the
  // write-side during a dive). When personal-vault support lands, swap
  // this to `vaultScopedProcedure` and forward `ctx.vaultSchema`.
  diveSpawn: authedProcedure
    .meta({ openapi: { method: "POST", path: "/api/research/dives/spawn", tags: ["research.dives"], protect: true } })
    .input(DiveSpawnInput)
    .output(z.any())
    .mutation(async ({ input }) => {
      const client = getBackendClient();
      return client.spawnDive({
        thread_id: input.threadId,
        seeds: input.seeds,
        budget_papers: input.budgetPapers,
        budget_seconds: input.budgetSeconds,
        focus: input.focus,
        vault_schema: "research_vault",
      });
    }),

  diveStatus: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/dives/status", tags: ["research.dives"] } })
    .input(z.object({ id: z.string().uuid() }))
    .output(z.any())
    .query(async ({ input }) => {
      const client = getBackendClient();
      const row = await client.getDiveStatus(input.id);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `dive ${input.id} not found`,
        });
      }
      return row;
    }),

  diveResults: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/dives/results", tags: ["research.dives"] } })
    .input(
      z.object({
        id: z.string().uuid(),
        topK: z.number().int().min(1).max(100).default(10),
      }),
    )
    .output(z.any())
    .query(async ({ input }) => {
      const client = getBackendClient();
      const row = await client.getDiveResults(input.id, input.topK);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `dive ${input.id} not found`,
        });
      }
      return row;
    }),

  /**
   * Recent and in-flight dives across the vault. Returns the last
   * `sinceDays` worth of `graph_exploration` rows whose status is one of
   * queued/running/done, newest-first. Used by the landing page's
   * "Active dives" panel to surface what the buddy's been up to.
   */
  divesRecent: vaultScopedProcedure
    .meta({ openapi: { method: "GET", path: "/api/research/dives/recent", tags: ["research.dives"] } })
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        sinceDays: z.number().int().min(1).max(90).default(7),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const sinceDate = new Date(
        Date.now() - input.sinceDays * 24 * 60 * 60 * 1000,
      );

      const rows = await ctx.db
        .select({
          id: graphExploration.id,
          threadId: graphExploration.threadId,
          seed: graphExploration.seed,
          status: graphExploration.status,
          budgetPapers: graphExploration.budgetPapers,
          budgetSeconds: graphExploration.budgetSeconds,
          startedAt: graphExploration.startedAt,
          finishedAt: graphExploration.finishedAt,
        })
        .from(graphExploration)
        .where(
          and(
            inArray(graphExploration.status, ["queued", "running", "done"]),
            or(
              isNull(graphExploration.startedAt),
              gte(graphExploration.startedAt, sinceDate),
            ),
          ),
        )
        .orderBy(desc(graphExploration.startedAt))
        .limit(input.limit);

      return {
        items: rows.map((r) => {
          const elapsedMs =
            r.startedAt instanceof Date
              ? (r.finishedAt instanceof Date
                  ? r.finishedAt.getTime()
                  : Date.now()) - r.startedAt.getTime()
              : null;
          return {
            id: r.id,
            threadId: r.threadId,
            seed: r.seed,
            status: r.status,
            budgetPapers: r.budgetPapers,
            budgetSeconds: r.budgetSeconds,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            elapsedMs,
          };
        }),
      };
    }),
} satisfies RouterRecord;
