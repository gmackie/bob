import { z } from "zod/v4";

import { and, desc, eq } from "@bob/db";
import { projects, repositories, workItems } from "@bob/db/schema";

import { detectProjectCapabilities } from "../services/projects/projectCapabilities";
import { protectedProcedure } from "../trpc";

export const projectRouter = {
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(128),
        key: z.string().min(1).max(16),
        description: z.string().optional(),
        color: z.string().max(7).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          key: input.key.toUpperCase(),
          description: input.description ?? null,
          color: input.color ?? null,
        })
        .returning();
      return project!;
    }),

  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const projectRows = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, input.workspaceId),
        orderBy: desc(projects.updatedAt),
      });

      const items = await ctx.db.query.workItems.findMany({
        where: eq(workItems.workspaceId, input.workspaceId),
      });

      return projectRows.map((project) => {
        const projectItems = items.filter((item) => item.projectId === project.id);

        return {
          project,
          counts: {
            issues: projectItems.filter((item) => item.kind === "issue").length,
            tasks: projectItems.filter((item) => item.kind === "task").length,
            epics: projectItems.filter((item) => item.kind === "epic").length,
            active: projectItems.filter(
              (item) =>
                item.status === "in_progress" || item.status === "in_review",
            ).length,
          },
        };
      });
    }),

  get: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.id),
      });

      if (!project) {
        return null;
      }

      const linkedRepository = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.planningProjectId, project.id),
          eq(repositories.userId, ctx.session.user.id),
        ),
      });

      const items = await ctx.db.query.workItems.findMany({
        where: eq(workItems.projectId, input.id),
      });

      const capabilities = detectProjectCapabilities({
        repositoryPath: linkedRepository?.path,
      });

      return {
        project,
        linkedRepository: linkedRepository
          ? {
              id: linkedRepository.id,
              name: linkedRepository.name,
              path: linkedRepository.path,
              remoteProvider: linkedRepository.remoteProvider,
              remoteOwner: linkedRepository.remoteOwner,
              remoteName: linkedRepository.remoteName,
              remoteUrl: linkedRepository.remoteUrl,
            }
          : null,
        capabilities,
        counts: {
          issues: items.filter((item) => item.kind === "issue").length,
          tasks: items.filter((item) => item.kind === "task").length,
          epics: items.filter((item) => item.kind === "epic").length,
          active: items.filter(
            (item) =>
              item.status === "in_progress" || item.status === "in_review",
          ).length,
        },
      };
    }),

  updateAutomationSettings: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        settings: z.object({
          autoDispatch: z.boolean().optional(),
          autoBranch: z.boolean().optional(),
          autoFeaturePR: z.boolean().optional(),
          ciTrigger: z.boolean().optional(),
          reactFrontend: z.boolean().optional(),
          stageSkills: z
            .record(
              z.string(),
              z.array(
                z.object({
                  slug: z.string(),
                  label: z.string(),
                  enabled: z.boolean(),
                }),
              ),
            )
            .optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        columns: { automationSettings: true },
      });

      if (!existing) {
        throw new Error("Project not found");
      }

      const merged = {
        ...(existing.automationSettings ?? {}),
        ...input.settings,
      };

      const [updated] = await ctx.db
        .update(projects)
        .set({ automationSettings: merged })
        .where(eq(projects.id, input.projectId))
        .returning();

      return updated!;
    }),
};
