import { z } from "zod/v4";

import {
  forgegraphApproveProdDeploy,
  forgegraphCreateDeployment,
  forgegraphCreateRevision,
  forgegraphGetRevision,
  forgegraphImportAllApps,
  forgegraphImportApp,
  forgegraphIngestRunEvent,
  forgegraphListApps,
  forgegraphListBuilds,
  forgegraphListDeployments,
  forgegraphListRevisions,
  forgegraphListUnlinkedApps,
  forgegraphTriggerBuild,
  forgegraphUpdateBuildStatus,
  forgegraphUpdateDeploymentStatus,
} from "../handlers/forgegraph";
import { protectedProcedure, requireFeature } from "../trpc";

export const forgegraphRouter = {
  listRevisions: protectedProcedure
    .input(
      z.object({
        repoId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(({ ctx, input }) =>
      forgegraphListRevisions(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  getRevision: protectedProcedure
    .input(z.object({ repoId: z.string().uuid(), revId: z.string() }))
    .query(({ ctx, input }) =>
      forgegraphGetRevision({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      forgegraphCreateRevision(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // ForgeGraph pipeline orchestration is a Pro-tier feature.
  triggerBuild: requireFeature("forgegraph")
    .input(
      z.object({
        revisionId: z.string().uuid(),
        repoId: z.string().uuid(),
        idempotencyKey: z.string(),
        ciProvider: z.string().optional(),
        taskId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      forgegraphTriggerBuild(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  updateBuildStatus: protectedProcedure
    .input(
      z.object({
        buildId: z.string().uuid(),
        status: z.string(),
        imageDigest: z.string().optional(),
        externalJobId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      forgegraphUpdateBuildStatus(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

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
    .mutation(({ ctx, input }) =>
      forgegraphCreateDeployment(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  updateDeploymentStatus: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().uuid(),
        status: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      forgegraphUpdateDeploymentStatus(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

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
    .mutation(({ ctx, input }) =>
      forgegraphIngestRunEvent(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  listDeployments: protectedProcedure
    .input(
      z.object({
        revisionId: z.string().uuid().optional(),
        repoId: z.string().uuid().optional(),
        environment: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      forgegraphListDeployments(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  listBuilds: protectedProcedure
    .input(
      z.object({
        revisionId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      forgegraphListBuilds({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  approveProdDeploy: protectedProcedure
    .input(z.object({ dispatchItemId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      forgegraphApproveProdDeploy(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // ── ForgeGraph App Management ──────────────────────────────────────

  listApps: protectedProcedure.query(() => forgegraphListApps()),

  listUnlinkedApps: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      forgegraphListUnlinkedApps(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  importApp: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        appId: z.string(),
        key: z.string().min(1).max(16).toUpperCase(),
      }),
    )
    .mutation(({ ctx, input }) =>
      forgegraphImportApp({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  importAllApps: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      forgegraphImportAllApps(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),
};
