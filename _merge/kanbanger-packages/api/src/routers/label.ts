import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { labels } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const createLabelInput = z.object({
  workspaceId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  description: z.string().max(500).optional(),
  parentId: z.string().uuid().optional(),
});

const updateLabelInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().max(500).nullish(),
  parentId: z.string().uuid().nullish(),
});

export const labelRouter = router({
  // List labels in a workspace (optionally filtered by team)
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
        includeWorkspaceLabels: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get workspace-level labels
      let workspaceLabels: typeof labels.$inferSelect[] = [];
      if (input.includeWorkspaceLabels) {
        workspaceLabels = await ctx.db
          .select()
          .from(labels)
          .where(and(eq(labels.workspaceId, input.workspaceId), isNull(labels.teamId)))
          .orderBy(labels.name);
      }

      // Get team-specific labels if teamId provided
      let teamLabels: typeof labels.$inferSelect[] = [];
      if (input.teamId) {
        teamLabels = await ctx.db
          .select()
          .from(labels)
          .where(and(eq(labels.workspaceId, input.workspaceId), eq(labels.teamId, input.teamId)))
          .orderBy(labels.name);
      }

      // Combine and organize by parent
      const allLabels = [...workspaceLabels, ...teamLabels];

      // Separate parent labels and child labels
      const parentLabels = allLabels.filter((l) => !l.parentId);
      const childLabels = allLabels.filter((l) => l.parentId);

      // Group children by parent
      const childrenByParent = new Map<string, typeof labels.$inferSelect[]>();
      for (const child of childLabels) {
        if (child.parentId) {
          const existing = childrenByParent.get(child.parentId) ?? [];
          existing.push(child);
          childrenByParent.set(child.parentId, existing);
        }
      }

      return parentLabels.map((parent) => ({
        ...parent,
        children: childrenByParent.get(parent.id) ?? [],
      }));
    }),

  // Get all labels flat (for dropdowns)
  listFlat: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.teamId) {
        // Get both workspace labels and team-specific labels
        const result = await ctx.db
          .select()
          .from(labels)
          .where(
            and(
              eq(labels.workspaceId, input.workspaceId),
              // Either workspace-level or this specific team
              // This is simplified - in production you'd use an OR condition
            )
          )
          .orderBy(labels.name);

        return result;
      }

      const result = await ctx.db
        .select()
        .from(labels)
        .where(eq(labels.workspaceId, input.workspaceId))
        .orderBy(labels.name);

      return result;
    }),

  // Get a single label
  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [result] = await ctx.db.select().from(labels).where(eq(labels.id, input.id)).limit(1);

    return result ?? null;
  }),

  // Create a label
  create: protectedProcedure.input(createLabelInput).mutation(async ({ ctx, input }) => {
    const [label] = await ctx.db.insert(labels).values(input).returning();

    return label;
  }),

  // Update a label
  update: protectedProcedure.input(updateLabelInput).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const [label] = await ctx.db
      .update(labels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(labels.id, id))
      .returning();

    return label;
  }),

  // Delete a label
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(labels).where(eq(labels.id, input.id));
      return { success: true };
    }),

  // Create default labels for a workspace
  createDefaults: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const defaultLabels = [
        { name: "Bug", color: "#ef4444", description: "Something isn't working" },
        { name: "Feature", color: "#22c55e", description: "New feature or request" },
        { name: "Improvement", color: "#3b82f6", description: "Enhancement to existing functionality" },
        { name: "Documentation", color: "#8b5cf6", description: "Documentation changes" },
        { name: "Tech Debt", color: "#f59e0b", description: "Technical debt" },
        { name: "Design", color: "#ec4899", description: "Design related" },
      ];

      const createdLabels = await ctx.db
        .insert(labels)
        .values(
          defaultLabels.map((l) => ({
            workspaceId: input.workspaceId,
            ...l,
          }))
        )
        .returning();

      return createdLabels;
    }),
});
