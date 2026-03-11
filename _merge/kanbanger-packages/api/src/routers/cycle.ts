import { z } from "zod";
import { eq, and, desc, gte, lte, sql, count, inArray } from "drizzle-orm";
import { cycles, issues, teams, teamMembers } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const cycleStatusEnum = z.enum(["upcoming", "active", "completed"]);

const createCycleInput = z.object({
  teamId: z.string().uuid(),
  name: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

const updateCycleInput = z.object({
  id: z.string().uuid(),
  name: z.string().max(100).nullish(),
  description: z.string().max(2000).nullish(),
  status: cycleStatusEnum.optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export const cycleRouter = router({
  listByWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        status: cycleStatusEnum.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) return [];

      const userTeams = await ctx.db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(
          and(
            eq(teamMembers.userId, user.id),
            eq(teams.workspaceId, input.workspaceId)
          )
        );

      const teamIds = userTeams.map((t) => t.teamId);
      if (teamIds.length === 0) return [];

      let query = ctx.db
        .select({
          cycle: cycles,
          team: teams,
        })
        .from(cycles)
        .innerJoin(teams, eq(cycles.teamId, teams.id))
        .where(inArray(cycles.teamId, teamIds))
        .$dynamic();

      if (input.status) {
        query = query.where(
          and(inArray(cycles.teamId, teamIds), eq(cycles.status, input.status))
        );
      }

      const result = await query.orderBy(desc(cycles.startDate));

      const cycleIds = result.map((r) => r.cycle.id);
      const issueCounts =
        cycleIds.length > 0
          ? await ctx.db
              .select({
                cycleId: issues.cycleId,
                total: count(),
                completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
              })
              .from(issues)
              .where(inArray(issues.cycleId, cycleIds))
              .groupBy(issues.cycleId)
          : [];

      const countsByCycle = new Map(issueCounts.map((c) => [c.cycleId, c]));

      return result.map(({ cycle, team }) => {
        const stats = countsByCycle.get(cycle.id) ?? { total: 0, completed: 0 };
        return {
          ...cycle,
          team: { id: team.id, name: team.name, key: team.key, color: team.color },
          stats,
          issueCount: stats.total,
          completedCount: stats.completed,
        };
      });
    }),

  list: protectedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        status: cycleStatusEnum.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .select()
        .from(cycles)
        .where(eq(cycles.teamId, input.teamId))
        .$dynamic();

      if (input.status) {
        query = query.where(and(eq(cycles.teamId, input.teamId), eq(cycles.status, input.status)));
      }

      const result = await query.orderBy(desc(cycles.startDate));

      // Get issue counts for each cycle
      const cycleIds = result.map((c) => c.id);
      const issueCounts =
        cycleIds.length > 0
          ? await ctx.db
              .select({
                cycleId: issues.cycleId,
                total: count(),
                completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
              })
              .from(issues)
              .where(eq(issues.cycleId, cycleIds[0]!)) // simplified
              .groupBy(issues.cycleId)
          : [];

      const countsByCycle = new Map(issueCounts.map((c) => [c.cycleId, c]));

      return result.map((cycle) => {
        const stats = countsByCycle.get(cycle.id) ?? { total: 0, completed: 0 };
        return {
          ...cycle,
          stats,
          issueCount: stats.total,
          completedCount: stats.completed,
        };
      });
    }),

  // Get current active cycle for a team
  current: protectedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [result] = await ctx.db
        .select()
        .from(cycles)
        .where(and(eq(cycles.teamId, input.teamId), eq(cycles.status, "active")))
        .limit(1);

      return result ?? null;
    }),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db
      .select({
        cycle: cycles,
        team: teams,
      })
      .from(cycles)
      .innerJoin(teams, eq(cycles.teamId, teams.id))
      .where(eq(cycles.id, input.id))
      .limit(1);

    if (result.length === 0) return null;
    const { cycle, team } = result[0]!;

    const [stats] = await ctx.db
      .select({
        total: count(),
        completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
        inProgress: sql<number>`count(*) filter (where ${issues.status} = 'in_progress')`,
        todo: sql<number>`count(*) filter (where ${issues.status} = 'todo')`,
        backlog: sql<number>`count(*) filter (where ${issues.status} = 'backlog')`,
      })
      .from(issues)
      .where(eq(issues.cycleId, input.id));

    return {
      ...cycle,
      team: { id: team.id, name: team.name, key: team.key, color: team.color },
      stats: stats ?? { total: 0, completed: 0, inProgress: 0, todo: 0, backlog: 0 },
    };
  }),

  issues: protectedProcedure
    .input(z.object({ cycleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.query.issues.findMany({
        where: eq(issues.cycleId, input.cycleId),
        with: {
          assignee: true,
          project: true,
          issueLabels: {
            with: { label: true },
          },
        },
        orderBy: [desc(issues.updatedAt)],
      });

      return result.map((issue) => ({
        ...issue,
        labels: issue.issueLabels.map((il) => il.label),
      }));
    }),

  // Create a new cycle
  create: protectedProcedure.input(createCycleInput).mutation(async ({ ctx, input }) => {
    // Get next cycle number for this team
    const [lastCycle] = await ctx.db
      .select({ number: cycles.number })
      .from(cycles)
      .where(eq(cycles.teamId, input.teamId))
      .orderBy(desc(cycles.number))
      .limit(1);

    const number = (lastCycle?.number ?? 0) + 1;

    // Default dates if not provided (current week)
    const now = new Date();
    const startDate = input.startDate ?? now;
    const endDate = input.endDate ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Determine status based on dates
    let status: "upcoming" | "active" | "completed" = "upcoming";
    if (startDate <= now && endDate >= now) {
      status = "active";
    } else if (endDate < now) {
      status = "completed";
    }

    const [cycle] = await ctx.db
      .insert(cycles)
      .values({
        teamId: input.teamId,
        name: input.name ?? `Cycle ${number}`,
        description: input.description,
        startDate,
        endDate,
        number,
        status,
      })
      .returning();

    return cycle;
  }),

  // Update a cycle
  update: protectedProcedure.input(updateCycleInput).mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;

    const [cycle] = await ctx.db
      .update(cycles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(cycles.id, id))
      .returning();

    return cycle;
  }),

  // Delete a cycle
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Remove cycle reference from issues
      await ctx.db.update(issues).set({ cycleId: null }).where(eq(issues.cycleId, input.id));

      await ctx.db.delete(cycles).where(eq(cycles.id, input.id));
      return { success: true };
    }),

  // Add issues to cycle
  addIssues: protectedProcedure
    .input(
      z.object({
        cycleId: z.string().uuid(),
        issueIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      for (const issueId of input.issueIds) {
        await ctx.db
          .update(issues)
          .set({ cycleId: input.cycleId, updatedAt: new Date() })
          .where(eq(issues.id, issueId));
      }

      return { success: true, count: input.issueIds.length };
    }),

  // Remove issues from cycle
  removeIssues: protectedProcedure
    .input(
      z.object({
        cycleId: z.string().uuid(),
        issueIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      for (const issueId of input.issueIds) {
        await ctx.db
          .update(issues)
          .set({ cycleId: null, updatedAt: new Date() })
          .where(and(eq(issues.id, issueId), eq(issues.cycleId, input.cycleId)));
      }

      return { success: true, count: input.issueIds.length };
    }),

  // Update cycle progress based on completed issues
  updateProgress: protectedProcedure
    .input(z.object({ cycleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [stats] = await ctx.db
        .select({
          total: count(),
          completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
        })
        .from(issues)
        .where(eq(issues.cycleId, input.cycleId));

      const progress = stats && stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      const [cycle] = await ctx.db
        .update(cycles)
        .set({ progress, updatedAt: new Date() })
        .where(eq(cycles.id, input.cycleId))
        .returning();

      return cycle;
    }),

  // Update cycle statuses based on current date (cron job)
  updateStatuses: protectedProcedure.mutation(async ({ ctx }) => {
    const now = new Date();

    // Mark cycles as active if they should be
    await ctx.db
      .update(cycles)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(cycles.status, "upcoming"),
          lte(cycles.startDate, now),
          gte(cycles.endDate, now)
        )
      );

    // Mark cycles as completed if they should be
    await ctx.db
      .update(cycles)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(eq(cycles.status, "active"), lte(cycles.endDate, now)));

    return { success: true };
  }),
});
