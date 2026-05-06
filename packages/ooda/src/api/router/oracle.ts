import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { oracleQueryLog } from "@gmacko/ooda/db/schema";
import { eq } from "@gmacko/ooda/db";

import { t, publicProcedure } from "../trpc";
import { withVaultScope } from "../middleware/vault-scope";
import { oracleQuery } from "../../oracle/query";
import { ingestAndEmbed } from "../../oracle/ingest";

const oracleTokenProcedure = t.procedure.use(async ({ ctx, next }) => {
  const secret = process.env.OODA_ORACLE_TOKEN;
  if (!secret) return next();
  const source = ctx.headers.get("x-trpc-source");
  if (source === "ooda-edge") return next();
  const bearer = ctx.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== secret) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid oracle token" });
  }
  return next();
}).use(withVaultScope);

export const oracleRouter = {
  query: oracleTokenProcedure
    .input(
      z.object({
        task: z.string().min(1),
        repo: z.string().optional(),
        question: z.string().min(1),
        topK: z.number().int().min(1).max(20).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "OPENAI_API_KEY not configured",
        });
      }

      return oracleQuery(
        ctx.db,
        ctx.vaultTables,
        input,
        apiKey,
      );
    }),

  logFeedback: oracleTokenProcedure
    .input(
      z.object({
        queryId: z.string().uuid(),
        used: z.boolean(),
        score: z.number().int().min(-1).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(oracleQueryLog)
        .set({
          agentUsedResult: input.used,
          feedbackScore: input.score ?? null,
        })
        .where(eq(oracleQueryLog.id, input.queryId));

      return { ok: true };
    }),

  ingest: oracleTokenProcedure
    .input(
      z.object({
        sourceId: z.number().int(),
        body: z.string(),
        contentAsOf: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "OPENAI_API_KEY not configured",
        });
      }

      return ingestAndEmbed(ctx.db, ctx.vaultTables, input, apiKey);
    }),
};
