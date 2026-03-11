import { z } from "zod";
import { eq, and, or, desc } from "drizzle-orm";
import { customViews, favorites, users } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const createViewInput = z.object({
  workspaceId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  filters: z.record(z.unknown()).default({}),
  sortBy: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  displayProperties: z.array(z.string()).optional(),
  shared: z.boolean().default(false),
});

const updateViewInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  icon: z.string().nullish(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullish(),
  filters: z.record(z.unknown()).optional(),
  sortBy: z.string().nullish(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  displayProperties: z.array(z.string()).nullish(),
  shared: z.boolean().optional(),
});

export const viewRouter = router({
  // List custom views
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        teamId: z.string().uuid().optional(),
        includeShared: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) return [];

      const conditions = [eq(customViews.workspaceId, input.workspaceId)];

      if (input.teamId) {
        conditions.push(
          or(eq(customViews.teamId, input.teamId), eq(customViews.teamId, null as unknown as string))!
        );
      }

      // Show user's own views or shared views
      if (input.includeShared) {
        conditions.push(
          or(eq(customViews.creatorId, user.id), eq(customViews.shared, true))!
        );
      } else {
        conditions.push(eq(customViews.creatorId, user.id));
      }

      const result = await ctx.db
        .select({
          view: customViews,
          creator: {
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(customViews)
        .innerJoin(users, eq(customViews.creatorId, users.id))
        .where(and(...conditions))
        .orderBy(customViews.name);

      return result.map((r) => ({
        ...r.view,
        creator: r.creator,
        isOwner: r.view.creatorId === user.id,
      }));
    }),

  // Get a single view
  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const user = ctx.user;

    const [result] = await ctx.db
      .select({
        view: customViews,
        creator: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(customViews)
      .innerJoin(users, eq(customViews.creatorId, users.id))
      .where(eq(customViews.id, input.id))
      .limit(1);

    if (!result) return null;

    return {
      ...result.view,
      creator: result.creator,
      isOwner: user && result.view.creatorId === user.id,
    };
  }),

  // Create a custom view
  create: protectedProcedure.input(createViewInput).mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    const [view] = await ctx.db
      .insert(customViews)
      .values({
        ...input,
        creatorId: user.id,
        displayProperties: input.displayProperties,
      })
      .returning();

    return view;
  }),

  // Update a custom view
  update: protectedProcedure.input(updateViewInput).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const [view] = await ctx.db
      .update(customViews)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customViews.id, id))
      .returning();

    return view;
  }),

  // Delete a custom view
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(customViews).where(eq(customViews.id, input.id));
      return { success: true };
    }),

  // Duplicate a view
  duplicate: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      const [original] = await ctx.db
        .select()
        .from(customViews)
        .where(eq(customViews.id, input.id))
        .limit(1);

      if (!original) {
        throw new Error("View not found");
      }

      const [view] = await ctx.db
        .insert(customViews)
        .values({
          workspaceId: original.workspaceId,
          teamId: original.teamId,
          creatorId: user.id,
          name: input.name ?? `${original.name} (copy)`,
          description: original.description,
          icon: original.icon,
          color: original.color,
          filters: original.filters,
          sortBy: original.sortBy,
          sortDirection: original.sortDirection,
          displayProperties: original.displayProperties,
          shared: false,
        })
        .returning();

      return view;
    }),
});

export const favoriteRouter = router({
  // List favorites for current user
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid().optional() }))
    .query(async ({ ctx }) => {
      const user = ctx.user;
      if (!user) return [];

      const result = await ctx.db
        .select()
        .from(favorites)
        .where(eq(favorites.userId, user.id))
        .orderBy(favorites.sortOrder);

      return result;
    }),

  // Add to favorites
  add: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        customViewId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      // Get max sort order
      const [maxOrder] = await ctx.db
        .select({ sortOrder: favorites.sortOrder })
        .from(favorites)
        .where(eq(favorites.userId, user.id))
        .orderBy(desc(favorites.sortOrder))
        .limit(1);

      const [favorite] = await ctx.db
        .insert(favorites)
        .values({
          userId: user.id,
          ...input,
          sortOrder: (maxOrder?.sortOrder ?? 0) + 1,
        })
        .returning();

      return favorite;
    }),

  // Remove from favorites
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(favorites).where(eq(favorites.id, input.id));
      return { success: true };
    }),

  // Remove by item (issue, project, or view)
  removeByItem: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        customViewId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      const conditions = [eq(favorites.userId, user.id)];

      if (input.issueId) {
        conditions.push(eq(favorites.issueId, input.issueId));
      }
      if (input.projectId) {
        conditions.push(eq(favorites.projectId, input.projectId));
      }
      if (input.customViewId) {
        conditions.push(eq(favorites.customViewId, input.customViewId));
      }

      await ctx.db.delete(favorites).where(and(...conditions));

      return { success: true };
    }),

  // Reorder favorites
  reorder: protectedProcedure
    .input(
      z.object({
        orderedIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      for (let i = 0; i < input.orderedIds.length; i++) {
        const id = input.orderedIds[i];
        if (id) {
          await ctx.db
            .update(favorites)
            .set({ sortOrder: i })
            .where(eq(favorites.id, id));
        }
      }

      return { success: true };
    }),
});
