import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  skillList,
  skillStats,
  skillSeed,
  skillGetExecution,
  skillListExecutions,
  skillRecordExecution,
  skillUpdateExecution,
} from "../handlers/skill";

const categorySchema = z.enum([
  "planning",
  "execution",
  "review",
  "deploy",
  "ops",
  "other",
]);
const sourceSchema = z.enum(["builtin", "gstack", "custom"]);
const statusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

export const skillRouter = {
  list: protectedProcedure
    .input(
      z
        .object({
          category: categorySchema.optional(),
          source: sourceSchema.optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      skillList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  stats: protectedProcedure
    .query(({ ctx }) =>
      skillStats({ db: ctx.db, userId: ctx.session.user.id }),
    ),

  seed: protectedProcedure.mutation(({ ctx }) =>
    skillSeed({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  getExecution: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      skillGetExecution({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listExecutions: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        workItemId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      skillListExecutions({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  recordExecution: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        skillId: z.string().uuid().optional(),
        skillSlug: z.string(),
        workItemId: z.string().uuid().optional(),
        parentExecutionId: z.string().uuid().optional(),
        status: statusSchema.optional(),
        input: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      skillRecordExecution({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateExecution: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusSchema.optional(),
        output: z.record(z.string(), z.unknown()).optional(),
        findings: z.array(z.unknown()).optional(),
        completedAt: z.coerce.date().optional(),
        durationMs: z.number().int().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      skillUpdateExecution({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
