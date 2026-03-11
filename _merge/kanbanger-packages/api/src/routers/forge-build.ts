import { forgeBuildArtifacts, forgeBuilds, forgeRepositories } from "@linear-clone/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveArtifactMetadataUrl } from "../lib/forge-storage";
import { protectedProcedure, router } from "../trpc";

export const forgeBuildTriggerInputSchema = z.object({
  repoId: z.string().min(1),
  revId: z.string().min(1),
  runId: z.string().optional(),
  taskId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1),
  ciProvider: z.string().optional(),
  stackKey: z.string().optional(),
});

export const forgeBuildUpdateStatusInputSchema = z.object({
  buildId: z.string().uuid(),
  status: z.enum(["queued", "running", "passed", "failed", "canceled", "superseded"]),
  externalJobId: z.string().optional(),
  imageDigest: z.string().optional(),
  artifactManifestRef: z.string().optional(),
});

export const forgeBuildAttachArtifactInputSchema = z.object({
  buildId: z.string().uuid(),
  type: z.string().min(1),
  digest: z.string().optional(),
  storageKey: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const forgeBuildListArtifactsInputSchema = z.object({
  buildId: z.string().uuid(),
});

export function isTerminalBuildStatus(status: string): boolean {
  return status === "passed" || status === "failed" || status === "canceled" || status === "superseded";
}

export const forgeBuildRouter = router({
  trigger: protectedProcedure
    .input(forgeBuildTriggerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(forgeBuilds)
        .where(eq(forgeBuilds.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (existing) {
        return { build: existing, idempotent: true };
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
        throw new Error("Failed to create build");
      }

      if (input.runId || input.stackKey) {
        const supersedeConditions = [eq(forgeBuilds.repoId, input.repoId), ne(forgeBuilds.id, created.id)];

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
          .where(
            and(
              ...supersedeConditions,
              inArray(forgeBuilds.status, ["queued", "running"])
            )
          );
      }

      return { build: created, idempotent: false };
    }),

  get: protectedProcedure
    .input(z.object({ buildId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [build] = await ctx.db
        .select()
        .from(forgeBuilds)
        .where(eq(forgeBuilds.id, input.buildId))
        .limit(1);

      return build ?? null;
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
      return ctx.db
        .select()
        .from(forgeBuilds)
        .where(and(eq(forgeBuilds.repoId, input.repoId), eq(forgeBuilds.revId, input.revId)))
        .orderBy(desc(forgeBuilds.createdAt))
        .limit(input.limit);
    }),

  listArtifacts: protectedProcedure
    .input(forgeBuildListArtifactsInputSchema)
    .query(async ({ ctx, input }) => {
      const [build] = await ctx.db
        .select({ repoId: forgeBuilds.repoId })
        .from(forgeBuilds)
        .where(sql`${forgeBuilds.id}::text = ${input.buildId}`)
        .limit(1);

      const [repo] = build
        ? await ctx.db
            .select({
              storageBackend: forgeRepositories.storageBackend,
              storagePrefix: forgeRepositories.storagePrefix,
            })
            .from(forgeRepositories)
            .where(eq(forgeRepositories.id, build.repoId))
            .limit(1)
        : [];

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

      if (!repo) {
        return items;
      }

      return items.map((artifact) => ({
        ...artifact,
        metadata: resolveArtifactMetadataUrl({
          storageBackend: repo.storageBackend,
          storagePrefix: repo.storagePrefix,
          storageKey: artifact.storageKey,
          metadata: artifact.metadata,
        }),
      }));
    }),

  updateStatus: protectedProcedure
    .input(forgeBuildUpdateStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
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

      return updated;
    }),

  attachArtifact: protectedProcedure
    .input(forgeBuildAttachArtifactInputSchema)
    .mutation(async ({ ctx, input }) => {
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

      return artifact;
    }),
});
