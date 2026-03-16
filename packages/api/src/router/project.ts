import { z } from "zod/v4";

import { desc, eq } from "@bob/db";
import { projects, workItems } from "@bob/db/schema";

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

      const items = await ctx.db.query.workItems.findMany({
        where: eq(workItems.projectId, input.id),
      });

      return {
        project,
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
};
