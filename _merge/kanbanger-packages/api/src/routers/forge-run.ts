import { forgeRepositories, forgeRunOverlays } from "@linear-clone/db";
import { and, desc, eq } from "drizzle-orm";
import { publishIssueEvent, SSE_EVENTS } from "@linear-clone/realtime/sse-server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const forgeRunGetInputSchema = z.object({
  runId: z.string().min(1),
});

export const forgeRunEventIngestInputSchema = z.object({
  runId: z.string().min(1),
  repoId: z.string().uuid(),
  revId: z.string().min(1),
  taskId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  eventType: z.enum([
    "created",
    "patch_applied",
    "tests_started",
    "tests_finished",
    "approved",
    "integrated",
    "failed",
  ]),
  testStatus: z.string().optional(),
  artifactRefs: z
    .array(
      z.object({
        type: z.enum(["log", "junit", "coverage", "build", "other"]),
        url: z.string().url().optional(),
        description: z.string().optional(),
      })
    )
    .optional(),
});

export function isIdempotentForgeRunUpdate(
  existing: {
    status: string;
    testStatus: string | null;
    artifactRefs: unknown;
  },
  input: {
    eventType: z.infer<typeof forgeRunEventIngestInputSchema>["eventType"];
    testStatus?: string;
    artifactRefs?: z.infer<typeof forgeRunEventIngestInputSchema>["artifactRefs"];
  }
): boolean {
  return (
    existing.status === input.eventType &&
    existing.testStatus === (input.testStatus ?? null) &&
    JSON.stringify(existing.artifactRefs ?? []) ===
      JSON.stringify(input.artifactRefs ?? existing.artifactRefs ?? [])
  );
}

export function buildForgeRunSsePayload(input: {
  runId: string;
  repoId: string;
  revId: string;
  status: string;
  testStatus?: string;
}) {
  return {
    runId: input.runId,
    repoId: input.repoId,
    revId: input.revId,
    status: input.status,
    testStatus: input.testStatus,
    updatedAt: new Date().toISOString(),
  };
}

export const forgeRunRouter = router({
  get: protectedProcedure
    .input(forgeRunGetInputSchema)
    .query(async ({ ctx, input }) => {
      const [overlay] = await ctx.db
        .select()
        .from(forgeRunOverlays)
        .where(eq(forgeRunOverlays.runId, input.runId))
        .orderBy(desc(forgeRunOverlays.updatedAt))
        .limit(1);

      return overlay ?? null;
    }),

  eventIngest: protectedProcedure
    .input(forgeRunEventIngestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(forgeRunOverlays)
        .where(
          and(
            eq(forgeRunOverlays.runId, input.runId),
            eq(forgeRunOverlays.repoId, input.repoId),
            eq(forgeRunOverlays.revId, input.revId)
          )
        )
        .limit(1);

      if (!existing) {
        const [created] = await ctx.db
          .insert(forgeRunOverlays)
          .values({
            runId: input.runId,
            repoId: input.repoId,
            revId: input.revId,
            taskId: input.taskId,
            agentId: input.agentId,
            status: input.eventType,
            testStatus: input.testStatus,
            artifactRefs: input.artifactRefs,
            timestamps: {
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          })
          .returning();

        const [repo] = await ctx.db
          .select({ workspaceId: forgeRepositories.workspaceId })
          .from(forgeRepositories)
          .where(eq(forgeRepositories.id, input.repoId))
          .limit(1);

        if (repo?.workspaceId) {
          void publishIssueEvent(
            SSE_EVENTS.FORGE_RUN_OVERLAY_UPDATED,
            repo.workspaceId,
            buildForgeRunSsePayload({
              runId: input.runId,
              repoId: input.repoId,
              revId: input.revId,
              status: input.eventType,
              testStatus: input.testStatus,
            })
          ).catch(() => {});
        }

        return { overlay: created, idempotent: false };
      }

      const unchanged = isIdempotentForgeRunUpdate(existing, input);

      if (unchanged) {
        return { overlay: existing, idempotent: true };
      }

      const [updated] = await ctx.db
        .update(forgeRunOverlays)
        .set({
          taskId: input.taskId ?? existing.taskId,
          agentId: input.agentId ?? existing.agentId,
          status: input.eventType,
          testStatus: input.testStatus ?? existing.testStatus,
          artifactRefs: input.artifactRefs ?? existing.artifactRefs,
          timestamps: {
            ...(existing.timestamps ?? {}),
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(forgeRunOverlays.id, existing.id))
        .returning();

      const [repo] = await ctx.db
        .select({ workspaceId: forgeRepositories.workspaceId })
        .from(forgeRepositories)
        .where(eq(forgeRepositories.id, input.repoId))
        .limit(1);

      if (repo?.workspaceId) {
        void publishIssueEvent(
          SSE_EVENTS.FORGE_RUN_OVERLAY_UPDATED,
          repo.workspaceId,
          buildForgeRunSsePayload({
            runId: input.runId,
            repoId: input.repoId,
            revId: input.revId,
            status: input.eventType,
            testStatus: input.testStatus,
          })
        ).catch(() => {});
      }

      return { overlay: updated, idempotent: false };
    }),
});
