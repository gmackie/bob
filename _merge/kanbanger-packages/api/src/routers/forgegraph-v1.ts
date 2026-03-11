import {
  forgeBuildArtifacts,
  forgeBuilds,
  forgeDeployments,
  forgeRepositories,
  forgeRevisions,
  forgeRunOverlays,
} from "@linear-clone/db";
import { publishIssueEvent, SSE_EVENTS } from "@linear-clone/realtime/sse-server";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { resolveArtifactMetadataUrl } from "../lib/forge-storage";

import {
  canTransitionDeploymentStatus,
  syncIssueFunnelStageFromDeployment,
  forgeDeploymentCreateInputSchema,
  forgeDeploymentUpdateStatusInputSchema,
} from "./forge-deployment";
import {
  forgeBuildAttachArtifactInputSchema,
  forgeBuildTriggerInputSchema,
  forgeBuildUpdateStatusInputSchema,
  forgeBuildListArtifactsInputSchema,
} from "./forge-build";
import {
  forgeRepositoryListInputSchema,
} from "./forge-repository";
import {
  forgeRevisionGetInputSchema,
  forgeRevisionListInputSchema,
  forgeRevisionRequestIndexInputSchema,
} from "./forge-revision";
import {
  buildForgeRunSsePayload,
  forgeRunEventIngestInputSchema,
  forgeRunGetInputSchema,
  isIdempotentForgeRunUpdate,
} from "./forge-run";

const forgeGraphV1ErrorCodeEnum = z.enum(["NOT_FOUND", "VALIDATION", "CONFLICT", "INTERNAL"]);

export type ForgeGraphV1ErrorCode = z.infer<typeof forgeGraphV1ErrorCodeEnum>;

export const forgeGraphV1ErrorSchema = z.object({
  code: forgeGraphV1ErrorCodeEnum,
  message: z.string().min(1),
  details: z.unknown().optional(),
  retriable: z.boolean().optional(),
});

export const forgeGraphV1ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: forgeGraphV1ErrorSchema,
});

export function forgeGraphV1Error(
  code: ForgeGraphV1ErrorCode,
  message: string,
  details?: unknown,
  retriable?: boolean
) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(retriable !== undefined ? { retriable } : {}),
    },
  };
}

export function forgeGraphV1OkItem<T>(item: T, meta?: Record<string, unknown>) {
  return {
    ok: true as const,
    item,
    ...(meta ? { meta } : {}),
  };
}

export function forgeGraphV1OkItems<T>(
  items: T[],
  meta: { limit: number } & Record<string, unknown>
) {
  return {
    ok: true as const,
    items,
    meta,
  };
}

function isIdempotentRevisionRequest(
  existing: {
    changeId: string | null;
    description: string | null;
    parentRevIds: string[];
    bookmarks: string[];
    metadata: unknown;
  },
  input: z.infer<typeof forgeRevisionRequestIndexInputSchema>
): boolean {
  const changeId = input.changeId ?? existing.changeId;
  const description = input.description ?? existing.description;
  const parentRevIds = input.parentRevIds ?? existing.parentRevIds;
  const bookmarks = input.bookmarks ?? existing.bookmarks;
  const metadata = input.metadata ?? existing.metadata;

  return (
    existing.changeId === changeId &&
    existing.description === description &&
    JSON.stringify(existing.parentRevIds) === JSON.stringify(parentRevIds) &&
    JSON.stringify(existing.bookmarks) === JSON.stringify(bookmarks) &&
    JSON.stringify(existing.metadata ?? null) === JSON.stringify(metadata ?? null)
  );
}

export const forgeGraphV1RepoListInputSchema = forgeRepositoryListInputSchema;
export const forgeGraphV1RevisionListInputSchema = forgeRevisionListInputSchema;
export const forgeGraphV1RevisionGetInputSchema = forgeRevisionGetInputSchema;
export const forgeGraphV1RevisionRequestIndexInputSchema = forgeRevisionRequestIndexInputSchema;

export const forgeGraphV1RunGetInputSchema = forgeRunGetInputSchema;
export const forgeGraphV1RunIngestEventInputSchema = forgeRunEventIngestInputSchema;

export const forgeGraphV1BuildTriggerInputSchema = forgeBuildTriggerInputSchema;
export const forgeGraphV1BuildUpdateStatusInputSchema = forgeBuildUpdateStatusInputSchema;
export const forgeGraphV1BuildAttachArtifactInputSchema = forgeBuildAttachArtifactInputSchema;
export const forgeGraphV1BuildListArtifactsInputSchema = forgeBuildListArtifactsInputSchema;

export const forgeGraphV1DeploymentCreateInputSchema = forgeDeploymentCreateInputSchema;
export const forgeGraphV1DeploymentUpdateStatusInputSchema = forgeDeploymentUpdateStatusInputSchema;

export const forgeGraphV1Router = router({
  repo: router({
    list: protectedProcedure
      .input(forgeGraphV1RepoListInputSchema)
      .query(async ({ ctx, input }) => {
        const items = await ctx.db
          .select()
          .from(forgeRepositories)
          .where(eq(forgeRepositories.workspaceId, input.workspaceId))
          .orderBy(desc(forgeRepositories.updatedAt));

        return forgeGraphV1OkItems(items, { limit: items.length });
      }),
  }),

  revision: router({
    list: protectedProcedure
      .input(forgeGraphV1RevisionListInputSchema)
      .query(async ({ ctx, input }) => {
        const items = await ctx.db
          .select()
          .from(forgeRevisions)
          .where(eq(forgeRevisions.repoId, input.repoId))
          .orderBy(desc(forgeRevisions.indexedAt))
          .limit(input.limit);

        return forgeGraphV1OkItems(items, { limit: input.limit });
      }),

    get: protectedProcedure
      .input(forgeGraphV1RevisionGetInputSchema)
      .query(async ({ ctx, input }) => {
        const [revision] = await ctx.db
          .select()
          .from(forgeRevisions)
          .where(and(eq(forgeRevisions.repoId, input.repoId), eq(forgeRevisions.revId, input.revId)))
          .limit(1);

        if (!revision) {
          return forgeGraphV1Error("NOT_FOUND", "Revision not found", {
            repoId: input.repoId,
            revId: input.revId,
          });
        }

        return forgeGraphV1OkItem(revision);
      }),

    requestIndex: protectedProcedure
      .input(forgeGraphV1RevisionRequestIndexInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(forgeRevisions)
          .where(and(eq(forgeRevisions.repoId, input.repoId), eq(forgeRevisions.revId, input.revId)))
          .limit(1);

        if (existing) {
          const unchanged = isIdempotentRevisionRequest(existing, input);
          if (unchanged) {
            return forgeGraphV1OkItem(existing, { idempotency: { replayed: true } });
          }

          const [updated] = await ctx.db
            .update(forgeRevisions)
            .set({
              changeId: input.changeId ?? existing.changeId,
              description: input.description ?? existing.description,
              parentRevIds: input.parentRevIds ?? existing.parentRevIds,
              bookmarks: input.bookmarks ?? existing.bookmarks,
              metadata: input.metadata ?? existing.metadata,
              indexedAt: new Date(),
            })
            .where(eq(forgeRevisions.id, existing.id))
            .returning();

          if (!updated) {
            return forgeGraphV1Error("INTERNAL", "Failed to update revision", undefined, true);
          }

          return forgeGraphV1OkItem(updated, { idempotency: { replayed: false } });
        }

        const [created] = await ctx.db
          .insert(forgeRevisions)
          .values({
            repoId: input.repoId,
            revId: input.revId,
            changeId: input.changeId,
            description: input.description,
            parentRevIds: input.parentRevIds ?? [],
            bookmarks: input.bookmarks ?? [],
            metadata: input.metadata,
          })
          .returning();

        if (!created) {
          return forgeGraphV1Error("INTERNAL", "Failed to create revision", undefined, true);
        }

        return forgeGraphV1OkItem(created, { idempotency: { replayed: false } });
      }),
  }),

  run: router({
    get: protectedProcedure
      .input(forgeGraphV1RunGetInputSchema)
      .query(async ({ ctx, input }) => {
        const [overlay] = await ctx.db
          .select()
          .from(forgeRunOverlays)
          .where(eq(forgeRunOverlays.runId, input.runId))
          .orderBy(desc(forgeRunOverlays.updatedAt))
          .limit(1);

        if (!overlay) {
          return forgeGraphV1Error("NOT_FOUND", "Run overlay not found", { runId: input.runId });
        }

        return forgeGraphV1OkItem(overlay);
      }),

    ingestEvent: protectedProcedure
      .input(forgeGraphV1RunIngestEventInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [repo] = await ctx.db
          .select({ workspaceId: forgeRepositories.workspaceId })
          .from(forgeRepositories)
          .where(eq(forgeRepositories.id, input.repoId))
          .limit(1);

        if (!repo) {
          return forgeGraphV1Error("NOT_FOUND", "Forge repository not found", {
            repoId: input.repoId,
          });
        }

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

          if (!created) {
            return forgeGraphV1Error("INTERNAL", "Failed to create run overlay", undefined, true);
          }

          if (repo.workspaceId) {
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

          return forgeGraphV1OkItem(created, { idempotency: { replayed: false } });
        }

        const unchanged = isIdempotentForgeRunUpdate(existing, input);
        if (unchanged) {
          return forgeGraphV1OkItem(existing, { idempotency: { replayed: true } });
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

        if (!updated) {
          return forgeGraphV1Error("INTERNAL", "Failed to update run overlay", undefined, true);
        }

        if (repo.workspaceId) {
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

        return forgeGraphV1OkItem(updated, { idempotency: { replayed: false } });
      }),
  }),

  build: router({
    trigger: protectedProcedure
      .input(forgeGraphV1BuildTriggerInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(forgeBuilds)
          .where(eq(forgeBuilds.idempotencyKey, input.idempotencyKey))
          .limit(1);

        if (existing) {
          return forgeGraphV1OkItem(existing, {
            idempotency: { key: input.idempotencyKey, replayed: true },
          });
        }

        const [created] = await ctx.db
          .insert(forgeBuilds)
          .values({
            repoId: input.repoId,
            revId: input.revId,
            runId: input.runId,
            taskId: input.taskId,
            status: "queued",
            idempotencyKey: input.idempotencyKey,
            ciProvider: input.ciProvider ?? "github_actions",
          })
          .returning();

        if (!created) {
          return forgeGraphV1Error("INTERNAL", "Failed to create build", undefined, true);
        }

        if (input.runId || input.stackKey) {
          const supersedeConditions = [
            eq(forgeBuilds.repoId, input.repoId),
            ne(forgeBuilds.id, created.id),
          ];

          if (input.runId) {
            supersedeConditions.push(eq(forgeBuilds.runId, input.runId));
          }

          if (input.stackKey) {
            supersedeConditions.push(eq(forgeBuilds.revId, input.stackKey));
          }

          await ctx.db
            .update(forgeBuilds)
            .set({
              status: "superseded",
              supersededByBuildId: created.id,
              updatedAt: new Date(),
              completedAt: new Date(),
            })
            .where(and(...supersedeConditions, inArray(forgeBuilds.status, ["queued", "running"])));
        }

        return forgeGraphV1OkItem(created, {
          idempotency: { key: input.idempotencyKey, replayed: false },
        });
      }),

    get: protectedProcedure
      .input(z.object({ buildId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [build] = await ctx.db
          .select()
          .from(forgeBuilds)
          .where(eq(forgeBuilds.id, input.buildId))
          .limit(1);

        if (!build) {
          return forgeGraphV1Error("NOT_FOUND", "Build not found", { buildId: input.buildId });
        }

        return forgeGraphV1OkItem(build);
      }),

    listByRevision: protectedProcedure
      .input(
        z.object({
          repoId: z.string().min(1),
          revId: z.string().min(1),
          limit: z.number().int().min(1).max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const items = await ctx.db
          .select()
          .from(forgeBuilds)
          .where(and(eq(forgeBuilds.repoId, input.repoId), eq(forgeBuilds.revId, input.revId)))
          .orderBy(desc(forgeBuilds.createdAt))
          .limit(input.limit);

        return forgeGraphV1OkItems(items, { limit: input.limit });
      }),

    updateStatus: protectedProcedure
      .input(forgeGraphV1BuildUpdateStatusInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select({ id: forgeBuilds.id })
          .from(forgeBuilds)
          .where(eq(forgeBuilds.id, input.buildId))
          .limit(1);

        if (!existing) {
          return forgeGraphV1Error("NOT_FOUND", "Build not found", { buildId: input.buildId });
        }

        const [updated] = await ctx.db
          .update(forgeBuilds)
          .set({
            status: input.status,
            externalJobId: input.externalJobId,
            imageDigest: input.imageDigest,
            artifactManifestRef: input.artifactManifestRef,
            startedAt: input.status === "running" ? new Date() : undefined,
            completedAt:
              input.status === "passed" ||
              input.status === "failed" ||
              input.status === "canceled" ||
              input.status === "superseded"
                ? new Date()
                : undefined,
            updatedAt: new Date(),
          })
          .where(eq(forgeBuilds.id, input.buildId))
          .returning();

        if (!updated) {
          return forgeGraphV1Error("INTERNAL", "Failed to update build", undefined, true);
        }

        return forgeGraphV1OkItem(updated);
      }),

    attachArtifact: protectedProcedure
      .input(forgeGraphV1BuildAttachArtifactInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [build] = await ctx.db
          .select({ id: forgeBuilds.id })
          .from(forgeBuilds)
          .where(eq(forgeBuilds.id, input.buildId))
          .limit(1);

        if (!build) {
          return forgeGraphV1Error("NOT_FOUND", "Build not found", { buildId: input.buildId });
        }

        const [artifact] = await ctx.db
          .insert(forgeBuildArtifacts)
          .values({
            buildId: input.buildId,
            type: input.type,
            digest: input.digest,
            storageKey: input.storageKey,
            sizeBytes: input.sizeBytes,
            metadata: input.metadata,
          })
          .returning();

        if (!artifact) {
          return forgeGraphV1Error("INTERNAL", "Failed to attach artifact", undefined, true);
        }

        return forgeGraphV1OkItem(artifact);
      }),

    listArtifacts: protectedProcedure
      .input(forgeGraphV1BuildListArtifactsInputSchema)
      .query(async ({ ctx, input }) => {
        const [buildWithRepo] = await ctx.db
          .select({
            storageBackend: forgeRepositories.storageBackend,
            storagePrefix: forgeRepositories.storagePrefix,
          })
          .from(forgeBuilds)
          .innerJoin(forgeRepositories, eq(forgeRepositories.id, forgeBuilds.repoId))
          .where(sql`${forgeBuilds.id}::text = ${input.buildId}`)
          .limit(1);

        const items = await ctx.db
          .select({
            id: forgeBuildArtifacts.id,
            buildId: forgeBuildArtifacts.buildId,
            type: forgeBuildArtifacts.type,
            digest: forgeBuildArtifacts.digest,
            storageKey: forgeBuildArtifacts.storageKey,
            sizeBytes: forgeBuildArtifacts.sizeBytes,
            metadata: forgeBuildArtifacts.metadata,
            createdAt: forgeBuildArtifacts.createdAt,
          })
          .from(forgeBuildArtifacts)
          .innerJoin(forgeBuilds, eq(forgeBuilds.id, forgeBuildArtifacts.buildId))
          .where(sql`${forgeBuilds.id}::text = ${input.buildId}`)
          .orderBy(desc(forgeBuildArtifacts.createdAt));

        if (!buildWithRepo) {
          return forgeGraphV1OkItems(items, { limit: items.length });
        }

        const itemsWithResolvedUrls = items.map((artifact) => ({
          ...artifact,
          metadata: resolveArtifactMetadataUrl({
            storageBackend: buildWithRepo.storageBackend,
            storagePrefix: buildWithRepo.storagePrefix,
            storageKey: artifact.storageKey,
            metadata: artifact.metadata,
          }),
        }));

        return forgeGraphV1OkItems(itemsWithResolvedUrls, { limit: items.length });
      }),
  }),

  deployment: router({
    create: protectedProcedure
      .input(forgeGraphV1DeploymentCreateInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [deployment] = await ctx.db
          .insert(forgeDeployments)
          .values({
            repoId: input.repoId,
            revId: input.revId,
            buildId: input.buildId,
            environment: input.environment,
            rollbackTargetDeploymentId: input.rollbackTargetDeploymentId,
            status: "pending_approval",
          })
          .returning();

        if (!deployment) {
          return forgeGraphV1Error("INTERNAL", "Failed to create deployment", undefined, true);
        }

        return forgeGraphV1OkItem(deployment);
      }),

    get: protectedProcedure
      .input(z.object({ deploymentId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [deployment] = await ctx.db
          .select()
          .from(forgeDeployments)
          .where(eq(forgeDeployments.id, input.deploymentId))
          .limit(1);

        if (!deployment) {
          return forgeGraphV1Error("NOT_FOUND", "Deployment not found", { deploymentId: input.deploymentId });
        }

        return forgeGraphV1OkItem(deployment);
      }),

    listByEnvironment: protectedProcedure
      .input(
        z.object({
          environment: z.enum(["dev", "staging", "prod", "preview"]),
          limit: z.number().int().min(1).max(100).default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        const items = await ctx.db
          .select()
          .from(forgeDeployments)
          .where(eq(forgeDeployments.environment, input.environment))
          .orderBy(desc(forgeDeployments.createdAt))
          .limit(input.limit);

        return forgeGraphV1OkItems(items, { limit: input.limit });
      }),

    updateStatus: protectedProcedure
      .input(forgeGraphV1DeploymentUpdateStatusInputSchema)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(forgeDeployments)
          .where(eq(forgeDeployments.id, input.deploymentId))
          .limit(1);

        if (!existing) {
          return forgeGraphV1Error("NOT_FOUND", "Deployment not found", {
            deploymentId: input.deploymentId,
          });
        }

        if (!canTransitionDeploymentStatus(existing.status, input.status)) {
          return forgeGraphV1Error(
            "VALIDATION",
            `Invalid deployment status transition: ${existing.status} -> ${input.status}`,
            { from: existing.status, to: input.status }
          );
        }

        const [updated] = await ctx.db
          .update(forgeDeployments)
          .set({
            status: input.status,
            deployedAt:
              input.status === "healthy" || input.status === "rolled_back"
                ? new Date()
                : undefined,
            updatedAt: new Date(),
          })
          .where(eq(forgeDeployments.id, input.deploymentId))
          .returning();

        if (!updated) {
          return forgeGraphV1Error("INTERNAL", "Failed to update deployment", undefined, true);
        }

        await syncIssueFunnelStageFromDeployment(ctx.db, updated);

        return forgeGraphV1OkItem(updated);
      }),
  }),
});
