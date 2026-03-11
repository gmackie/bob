import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import {
  workspaces,
  workspaceMembers,
  users,
} from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const createWorkspaceInput = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  logoUrl: z.string().url().optional(),
});

const updateWorkspaceInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  logoUrl: z.string().url().nullish(),
});

export const workspaceRouter = router({
  // List all workspaces for current user
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) return [];

    const memberships = await ctx.db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(desc(workspaces.createdAt));

    return memberships;
  }),

  // Get a single workspace by ID or slug
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid().optional(), slug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (!input.id && !input.slug) {
        return null;
      }

      const result = await ctx.db
        .select()
        .from(workspaces)
        .where(input.id ? eq(workspaces.id, input.id) : eq(workspaces.slug, input.slug!))
        .limit(1);

      return result[0] ?? null;
    }),

  // Create a new workspace
  create: protectedProcedure
    .input(createWorkspaceInput)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) {
        throw new Error("User not found");
      }

      // Create workspace
      const [workspace] = await ctx.db
        .insert(workspaces)
        .values({
          name: input.name,
          slug: input.slug,
          logoUrl: input.logoUrl,
          ownerId: user.id,
        })
        .returning();

      if (!workspace) {
        throw new Error("Failed to create workspace");
      }

      // Add creator as admin member
      await ctx.db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "admin",
      });

      return workspace;
    }),

  // Update a workspace
  update: protectedProcedure
    .input(updateWorkspaceInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const [workspace] = await ctx.db
        .update(workspaces)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(workspaces.id, id))
        .returning();

      return workspace;
    }),

  // Delete a workspace
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(workspaces).where(eq(workspaces.id, input.id));
      return { success: true };
    }),

  // Get workspace members
  members: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.db
        .select({
          id: workspaceMembers.id,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.joinedAt,
          user: {
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(workspaceMembers.userId, users.id))
        .where(eq(workspaceMembers.workspaceId, input.workspaceId));

      return members;
    }),

  // Add member to workspace
  addMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "member", "guest"]).default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [member] = await ctx.db
        .insert(workspaceMembers)
        .values({
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role,
        })
        .returning();

      return member;
    }),

  // Update member role
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "member", "guest"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [member] = await ctx.db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId)
          )
        )
        .returning();

      return member;
    }),

  // Remove member from workspace
  removeMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId)
          )
        );

      return { success: true };
    }),
});
