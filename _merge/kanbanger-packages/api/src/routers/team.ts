import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { teams, teamMembers, users } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const createTeamInput = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, "Key must be uppercase letters and numbers only"),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().optional(),
  timezone: z.string().optional(),
});

const updateTeamInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/)
    .optional(),
  description: z.string().max(500).nullish(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().nullish(),
  timezone: z.string().optional(),
  defaultAssigneeId: z.string().uuid().nullish(),
});

export const teamRouter = router({
  // List teams in a workspace
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select()
        .from(teams)
        .where(eq(teams.workspaceId, input.workspaceId))
        .orderBy(teams.name);

      return result;
    }),

  // List teams the current user is a member of
  myTeams: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) return [];

      const result = await ctx.db
        .select({
          team: teams,
          role: teamMembers.role,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(
          and(
            eq(teamMembers.userId, user.id),
            eq(teams.workspaceId, input.workspaceId)
          )
        )
        .orderBy(teams.name);

      return result;
    }),

  // Get a single team
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select()
        .from(teams)
        .where(eq(teams.id, input.id))
        .limit(1);

      return result[0] ?? null;
    }),

  // Get team by key within workspace
  getByKey: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), key: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select()
        .from(teams)
        .where(and(eq(teams.workspaceId, input.workspaceId), eq(teams.key, input.key)))
        .limit(1);

      return result[0] ?? null;
    }),

  // Create a new team
  create: protectedProcedure.input(createTeamInput).mutation(async ({ ctx, input }) => {
    const user = ctx.user;
    if (!user) {
      throw new Error("User not found");
    }

    // Create team
    const [team] = await ctx.db.insert(teams).values(input).returning();

    if (!team) {
      throw new Error("Failed to create team");
    }

    // Add creator as admin member
    await ctx.db.insert(teamMembers).values({
      teamId: team.id,
      userId: user.id,
      role: "admin",
    });

    return team;
  }),

  // Update a team
  update: protectedProcedure.input(updateTeamInput).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const [team] = await ctx.db
      .update(teams)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(teams.id, id))
      .returning();

    return team;
  }),

  // Delete a team
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(teams).where(eq(teams.id, input.id));
      return { success: true };
    }),

  // Get team members
  members: protectedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.db
        .select({
          id: teamMembers.id,
          role: teamMembers.role,
          joinedAt: teamMembers.joinedAt,
          user: {
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, input.teamId));

      return members;
    }),

  // Add member to team
  addMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "member"]).default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [member] = await ctx.db
        .insert(teamMembers)
        .values({
          teamId: input.teamId,
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
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "member"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [member] = await ctx.db
        .update(teamMembers)
        .set({ role: input.role })
        .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)))
        .returning();

      return member;
    }),

  // Remove member from team
  removeMember: protectedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)));

      return { success: true };
    }),

  // Increment issue count for a team (internal use)
  incrementIssueCount: protectedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [team] = await ctx.db
        .update(teams)
        .set({
          issueCount: sql`${teams.issueCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(teams.id, input.teamId))
        .returning();

      return team;
    }),
});
