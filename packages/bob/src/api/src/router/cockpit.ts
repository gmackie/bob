import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  controlBumpPriority,
  controlRetryItem,
  controlReviewPr,
  controlSetAgentEnabled,
  controlSetBudget,
  controlSetDispatchEnabled,
  controlStopSession,
  controlTriggerReview,
} from "../handlers/cockpitControls";
import { cockpitStatus } from "../handlers/cockpitStatus";
import { protectedProcedure } from "../trpc";

/**
 * /cockpit data. Read-only in V1; the wall polls `status` every ~10 s and on
 * workspace broadcasts. Controls (stop/retry/bump/pause/…) arrive in V2 as
 * owner-only mutations on this same router.
 */
export const cockpitRouter = {
  status: protectedProcedure
    .input(
      z
        .object({
          includeOoda: z.boolean().default(false),
        })
        .default({ includeOoda: false }),
    )
    .query(({ input }) =>
      cockpitStatus({
        includeOoda: input.includeOoda,
        forgejoToken: process.env.BOB_FORGEJO_TOKEN,
        forgejoInstanceUrl: process.env.BOB_FORGEJO_INSTANCE_URL ?? "https://git.forgegraf.com",
        rotation: (process.env.BOB_AUTO_DRAIN_AGENTS ?? "claude,codex,grok,cursor")
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        repairCap: Number(process.env.BOB_AUTO_REPAIR_MAX_ATTEMPTS_PER_PR ?? 3),
      }),
    ),

  // --- V2 controls: owner-only, every call audited (cockpit_audit). ---
  stopSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) => controlStopSession({ userId: ctx.session.user.id }, input)),
  retryItem: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .mutation(({ ctx, input }) => controlRetryItem({ userId: ctx.session.user.id }, input)),
  bumpPriority: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid(), priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }))
    .mutation(({ ctx, input }) => controlBumpPriority({ userId: ctx.session.user.id }, input)),
  setDispatchEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) => controlSetDispatchEnabled({ userId: ctx.session.user.id }, input)),
  setBudget: protectedProcedure
    .input(z.object({ dailyCap: z.number().int().min(1).max(500).optional(), concurrency: z.number().int().min(1).max(16).optional() }))
    .mutation(({ ctx, input }) => controlSetBudget({ userId: ctx.session.user.id }, input)),
  setAgentEnabled: protectedProcedure
    .input(z.object({ agent: z.string(), enabled: z.boolean() }))
    .mutation(({ ctx, input }) => controlSetAgentEnabled({ userId: ctx.session.user.id }, input)),
  triggerReview: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .mutation(({ ctx, input }) => controlTriggerReview({ userId: ctx.session.user.id }, input)),
  reviewPr: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid(), verdict: z.enum(["APPROVE", "REQUEST_CHANGES"]), body: z.string().max(4000).optional() }))
    .mutation(({ ctx, input }) => controlReviewPr({ userId: ctx.session.user.id }, input)),
} satisfies TRPCRouterRecord;
