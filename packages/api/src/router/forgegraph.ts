import { z } from "zod/v4";
import { and, desc, eq } from "@bob/db";
import {
  dispatchItems,
  forgeRevisions,
  forgeBuilds,
  forgeDeployments,
  forgeRunEvents,
} from "@bob/db/schema";
import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../trpc";

export const forgegraphRouter = {
  listRevisions: protectedProcedure
    .input(
      z.object({
        repoId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.repoId)
        conditions.push(eq(forgeRevisions.repoId, input.repoId));
      if (input.taskId)
        conditions.push(eq(forgeRevisions.taskId, input.taskId));

      return ctx.db.query.forgeRevisions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(forgeRevisions.createdAt)],
        limit: input.limit,
      });
    }),

  getRevision: protectedProcedure
    .input(z.object({ repoId: z.string().uuid(), revId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.forgeRevisions.findFirst({
        where: and(
          eq(forgeRevisions.repoId, input.repoId),
          eq(forgeRevisions.revId, input.revId),
        ),
        with: {
          builds: true,
          deployments: true,
          runEvents: true,
        },
      });
    }),

  createRevision: protectedProcedure
    .input(
      z.object({
        repoId: z.string().uuid(),
        revId: z.string(),
        taskId: z.string().uuid().optional(),
        taskRunId: z.string().uuid().optional(),
        branch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [revision] = await ctx.db
        .insert(forgeRevisions)
        .values({
          repoId: input.repoId,
          revId: input.revId,
          taskId: input.taskId,
          taskRunId: input.taskRunId,
          branch: input.branch,
        })
        .onConflictDoUpdate({
          target: [forgeRevisions.repoId, forgeRevisions.revId],
          set: {
            taskId: input.taskId,
            taskRunId: input.taskRunId,
            branch: input.branch,
          },
        })
        .returning();
      return revision!;
    }),

  triggerBuild: protectedProcedure
    .input(
      z.object({
        revisionId: z.string().uuid(),
        repoId: z.string().uuid(),
        idempotencyKey: z.string(),
        ciProvider: z.string().optional(),
        taskId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [build] = await ctx.db
        .insert(forgeBuilds)
        .values({
          revisionId: input.revisionId,
          repoId: input.repoId,
          idempotencyKey: input.idempotencyKey,
          ciProvider: input.ciProvider,
        })
        .onConflictDoNothing({
          target: [forgeBuilds.idempotencyKey],
        })
        .returning();

      if (!build) {
        // Idempotency conflict — return existing build
        return ctx.db.query.forgeBuilds.findFirst({
          where: eq(forgeBuilds.idempotencyKey, input.idempotencyKey),
        });
      }
      return build;
    }),

  updateBuildStatus: protectedProcedure
    .input(
      z.object({
        buildId: z.string().uuid(),
        status: z.string(),
        imageDigest: z.string().optional(),
        externalJobId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(forgeBuilds)
        .set({
          status: input.status,
          imageDigest: input.imageDigest,
          externalJobId: input.externalJobId,
        })
        .where(eq(forgeBuilds.id, input.buildId))
        .returning();
      return updated;
    }),

  createDeployment: protectedProcedure
    .input(
      z.object({
        revisionId: z.string().uuid(),
        buildId: z.string().uuid(),
        repoId: z.string().uuid(),
        environment: z.string(),
        rollbackTargetId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [deployment] = await ctx.db
        .insert(forgeDeployments)
        .values({
          revisionId: input.revisionId,
          buildId: input.buildId,
          repoId: input.repoId,
          environment: input.environment,
          rollbackTargetId: input.rollbackTargetId,
        })
        .returning();
      return deployment!;
    }),

  updateDeploymentStatus: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().uuid(),
        status: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(forgeDeployments)
        .set({ status: input.status })
        .where(eq(forgeDeployments.id, input.deploymentId))
        .returning();
      return updated;
    }),

  ingestRunEvent: protectedProcedure
    .input(
      z.object({
        runId: z.string(),
        repoId: z.string().uuid(),
        revisionId: z.string().uuid(),
        eventType: z.string(),
        taskId: z.string().uuid().optional(),
        agentId: z.string().uuid().optional(),
        testStatus: z.string().optional(),
        artifactRefs: z
          .array(
            z.object({
              type: z.string(),
              url: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [event] = await ctx.db
        .insert(forgeRunEvents)
        .values({
          runId: input.runId,
          repoId: input.repoId,
          revisionId: input.revisionId,
          eventType: input.eventType,
          taskId: input.taskId,
          agentId: input.agentId,
          testStatus: input.testStatus,
          artifactRefs: input.artifactRefs ?? [],
        })
        .returning();
      return event!;
    }),

  listDeployments: protectedProcedure
    .input(
      z.object({
        revisionId: z.string().uuid().optional(),
        repoId: z.string().uuid().optional(),
        environment: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.revisionId)
        conditions.push(eq(forgeDeployments.revisionId, input.revisionId));
      if (input.repoId)
        conditions.push(eq(forgeDeployments.repoId, input.repoId));
      if (input.environment)
        conditions.push(eq(forgeDeployments.environment, input.environment));

      return ctx.db.query.forgeDeployments.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(forgeDeployments.createdAt)],
      });
    }),

  listBuilds: protectedProcedure
    .input(
      z.object({
        revisionId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.forgeBuilds.findMany({
        where: input.revisionId
          ? eq(forgeBuilds.revisionId, input.revisionId)
          : undefined,
        orderBy: [desc(forgeBuilds.createdAt)],
      });
    }),

  approveProdDeploy: protectedProcedure
    .input(z.object({ dispatchItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify item is in awaiting_prod_approval state
      const item = await ctx.db.query.dispatchItems.findFirst({
        where: eq(dispatchItems.id, input.dispatchItemId),
      });

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Dispatch item not found",
        });
      }

      if (item.pipelineState !== "awaiting_prod_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Item is in state "${item.pipelineState}", expected "awaiting_prod_approval"`,
        });
      }

      // Find the build for this item (keyed by item.id)
      const build = await ctx.db.query.forgeBuilds.findFirst({
        where: eq(forgeBuilds.idempotencyKey, item.id),
      });

      if (!build) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No build found for this dispatch item",
        });
      }

      const revision = await ctx.db.query.forgeRevisions.findFirst({
        where: eq(forgeRevisions.id, build.revisionId),
      });

      if (!revision) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No revision found for this build",
        });
      }

      // Create prod deployment
      const [deployment] = await ctx.db
        .insert(forgeDeployments)
        .values({
          revisionId: revision.id,
          buildId: build.id,
          repoId: revision.repoId,
          environment: "prod",
          status: "deploying",
        })
        .returning();

      // Set state to deploying_prod
      await ctx.db
        .update(dispatchItems)
        .set({ pipelineState: "deploying_prod" })
        .where(eq(dispatchItems.id, item.id));

      return deployment!;
    }),
};
