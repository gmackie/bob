import { z } from "zod";
import { eq, and, or, like, inArray } from "drizzle-orm";
import { users, workspaceMembers, teamMembers } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";
import { generateApiKey, revokeApiKey, listApiKeys } from "@linear-clone/auth/api-key";

export const userRouter = router({
  // Get current user
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.user;
  }),

  // Update current user's profile
  updateProfile: protectedProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        name: z.string().min(1).max(100).optional(),
        avatarUrl: z.string().url().nullish(),
        timezone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new Error("User not found");
      }

      const result = await ctx.db
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id))
        .returning();

      return result[0] ?? null;
    }),

  // Get user by ID
  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        timezone: users.timezone,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, input.id))
      .limit(1);

    return user ?? null;
  }),

  // Search users in workspace
  search: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        query: z.string().min(1),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .innerJoin(workspaceMembers, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            or(
              like(users.name, `%${input.query}%`),
              like(users.email, `%${input.query}%`)
            )
          )
        )
        .limit(input.limit);

      return result;
    }),

  // List users in a workspace
  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(users)
        .innerJoin(workspaceMembers, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, input.workspaceId))
        .orderBy(users.name);

      return result;
    }),

  // List users in a team
  listByTeam: protectedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
          role: teamMembers.role,
          joinedAt: teamMembers.joinedAt,
        })
        .from(users)
        .innerJoin(teamMembers, eq(users.id, teamMembers.userId))
        .where(eq(teamMembers.teamId, input.teamId))
        .orderBy(users.name);

      return result;
    }),

  // Get multiple users by IDs
  getMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .query(async ({ ctx, input }) => {
      if (input.ids.length === 0) return [];

      const result = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(users.id, input.ids));

      return result;
    }),

  // Invite user to workspace (creates user if doesn't exist)
  invite: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["admin", "member", "guest"]).default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user already exists
      let [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      // If not, we'd typically send an invitation email
      // For now, just return a pending invitation status
      if (!user) {
        return {
          status: "invitation_pending",
          email: input.email,
          message: "Invitation sent (user will be added when they sign up)",
        };
      }

      // Check if already a member
      const [existingMember] = await ctx.db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, user.id)
          )
        )
        .limit(1);

      if (existingMember) {
        return {
          status: "already_member",
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        };
      }

      // Add to workspace
      await ctx.db.insert(workspaceMembers).values({
        workspaceId: input.workspaceId,
        userId: user.id,
        role: input.role,
      });

      return {
        status: "added",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }),

  // ================== API Key Management (for MCP/LLM agents) ==================

  // List API keys for current user
  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new Error("User not found");
    }
    return listApiKeys(ctx.db, ctx.user.id);
  }),

  // Create a new API key
  createApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        scopes: z.array(z.enum(["read", "write", "admin"])).default(["read"]),
        expiresInDays: z.number().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new Error("User not found");
      }

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;

      // Generate the key - the raw key is only returned once!
      const result = await generateApiKey(ctx.db, ctx.user.id, input.name, input.scopes, expiresAt);

      return {
        id: result.id,
        name: input.name,
        key: result.rawKey, // Only shown once - user must save this!
        scopes: input.scopes,
        expiresAt,
        createdAt: new Date(),
      };
    }),

  // Revoke an API key
  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new Error("User not found");
      }

      // Verify the key belongs to the user and revoke it
      const revoked = await revokeApiKey(ctx.db, input.id, ctx.user.id);

      if (!revoked) {
        throw new Error("API key not found");
      }

      return { success: true };
    }),
});
