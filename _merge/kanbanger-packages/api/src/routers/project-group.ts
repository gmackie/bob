import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { projectGroups, projects } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const GROUP_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e",
];

function getRandomColor(): string {
  return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)]!;
}

export const projectGroupRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const groups = await ctx.db
        .select()
        .from(projectGroups)
        .where(eq(projectGroups.workspaceId, input.workspaceId))
        .orderBy(asc(projectGroups.sortOrder), asc(projectGroups.name));

      return groups;
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(100),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existingGroups = await ctx.db
        .select({ sortOrder: projectGroups.sortOrder })
        .from(projectGroups)
        .where(eq(projectGroups.workspaceId, input.workspaceId))
        .orderBy(asc(projectGroups.sortOrder));

      const maxSortOrder = existingGroups.length > 0
        ? Math.max(...existingGroups.map(g => g.sortOrder))
        : -1;

      const [group] = await ctx.db
        .insert(projectGroups)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          color: input.color ?? getRandomColor(),
          icon: input.icon,
          sortOrder: maxSortOrder + 1,
        })
        .returning();

      return group;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        icon: z.string().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const [group] = await ctx.db
        .update(projectGroups)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projectGroups.id, id))
        .returning();

      return group;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(projects)
        .set({ groupId: null })
        .where(eq(projects.groupId, input.id));

      await ctx.db.delete(projectGroups).where(eq(projectGroups.id, input.id));

      return { success: true };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        groupIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await Promise.all(
        input.groupIds.map((id, index) =>
          ctx.db
            .update(projectGroups)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(
                eq(projectGroups.id, id),
                eq(projectGroups.workspaceId, input.workspaceId)
              )
            )
        )
      );

      return { success: true };
    }),

  addProject: protectedProcedure
    .input(
      z.object({
        groupId: z.string().uuid().nullable(),
        projectId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .update(projects)
        .set({ groupId: input.groupId, updatedAt: new Date() })
        .where(eq(projects.id, input.projectId))
        .returning();

      return project;
    }),
});
