import { z } from "zod";
import { eq, and, sql, count, like, desc, lt } from "drizzle-orm";
import {
  projects,
  forgeRepositories,
  projectTeams,
  teams,
  users,
  issues,
  integrationRepos,
  issueGitLinks,
  activities,
  issueDependencies,
  cycles,
  type Database,
} from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const projectStatusEnum = z.enum([
  "backlog",
  "planned",
  "in_progress",
  "paused",
  "completed",
  "canceled",
]);

const repositoryProviderEnum = z.enum(["github", "gitea", "gitlab"]);
const forgeStorageBackendEnum = z.enum(["s3", "rsync"]);
export const bobLaunchPolicySchema = z.enum(["auto_or_manual", "manual_only"]);

const createProjectInput = z
  .object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]*$/, "Key must be uppercase alphanumeric, starting with a letter")
    .optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status: projectStatusEnum.default("backlog"),
  leadId: z.string().uuid().optional(),
  startDate: z.date().optional(),
  targetDate: z.date().optional(),
  teamIds: z.array(z.string().uuid()).optional(),
  repositoryProvider: repositoryProviderEnum.optional(),
  repositoryFullName: z.string().optional(),
  repositoryUrl: z.string().url().optional(),
  repositoryExternalId: z.string().optional(),
  createForgeRepository: z.boolean().optional(),
  forgeRepositoryName: z.string().min(1).max(100).optional(),
  forgeRepositoryStorageBackend: forgeStorageBackendEnum.optional(),
  forgeRepositoryStoragePrefix: z.string().min(1).optional(),
  forgeRepositoryId: z.string().uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.createForgeRepository && input.forgeRepositoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot create a new forge repository and link an existing one at the same time",
        path: ["forgeRepositoryId"],
      });
    }
  });

const issueSyncDirectionEnum = z.enum(["outbound_only", "inbound_only", "bidirectional"]);

export const updateProjectInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]*$/)
    .optional(),
  description: z.string().max(2000).nullish(),
  icon: z.string().nullish(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status: projectStatusEnum.optional(),
  leadId: z.string().uuid().nullish(),
  startDate: z.date().nullish(),
  targetDate: z.date().nullish(),
  progress: z.number().min(0).max(100).optional(),
  sortOrder: z.number().optional(),
  repositoryProvider: repositoryProviderEnum.nullish(),
  repositoryFullName: z.string().nullish(),
  repositoryUrl: z.string().url().nullish(),
  repositoryExternalId: z.string().nullish(),
  forgeRepositoryId: z.string().uuid().nullish(),
  createForgeRepository: z.boolean().optional(),
  forgeRepositoryName: z.string().min(1).max(100).optional(),
  forgeRepositoryStorageBackend: forgeStorageBackendEnum.optional(),
  forgeRepositoryStoragePrefix: z.string().min(1).optional(),
  issueSyncEnabled: z.boolean().optional(),
  issueSyncDirection: issueSyncDirectionEnum.optional(),
  bobLaunchPolicy: bobLaunchPolicySchema.nullish(),
  bobAwaitingInputTimeoutMinutes: z.number().int().min(1).max(1440).nullish(),
}).superRefine((input, ctx) => {
  if (input.createForgeRepository && input.forgeRepositoryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cannot create a new forge repository and link an existing one at the same time",
      path: ["forgeRepositoryId"],
    });
  }

  if (input.createForgeRepository && input.forgeRepositoryId === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cannot clear forge repository while creating a new one",
      path: ["createForgeRepository"],
    });
  }
});

function generateKeyFromName(name: string): string {
  const words = name.toUpperCase().split(/\s+/);
  if (words.length === 1) {
    return words[0]!.slice(0, 4).replace(/[^A-Z0-9]/g, "");
  }
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 6)
    .replace(/[^A-Z0-9]/g, "");
}

const PROJECT_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e",
];

function getRandomColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]!;
}

async function getProjectById(db: Database, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

async function getUniqueKey(
  db: any,
  workspaceId: string,
  baseKey: string
): Promise<string> {
  const existing = await db
    .select({ key: projects.key })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, workspaceId), like(projects.key, `${baseKey}%`))
    );

  const existingKeys = new Set(existing.map((p: { key: string }) => p.key));
  if (!existingKeys.has(baseKey)) return baseKey;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${baseKey}${i}`;
    if (!existingKeys.has(candidate)) return candidate;
  }
  throw new Error("Could not generate unique project key");
}

function makeForgeStoragePrefix(
  workspaceId: string,
  projectId: string,
  providedPrefix: string | undefined
) {
  if (providedPrefix?.trim()) {
    return providedPrefix.trim();
  }

  return `${workspaceId}/${projectId}`;
}

async function ensureProjectForgeRepository(
  db: Database,
  project: { id: string; workspaceId: string; forgeRepositoryId: string | null },
  params: {
    createForgeRepository?: boolean;
    forgeRepositoryId?: string | null;
    forgeRepositoryName?: string;
    forgeStorageBackend?: "s3" | "rsync";
    forgeStoragePrefix?: string;
  }
) {
  if (params.forgeRepositoryId === null) {
    await db
      .update(projects)
      .set({ forgeRepositoryId: null, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    return;
  }

  if (params.forgeRepositoryId) {
    const [existingRepo] = await db
      .select({ id: forgeRepositories.id, workspaceId: forgeRepositories.workspaceId })
      .from(forgeRepositories)
      .where(eq(forgeRepositories.id, params.forgeRepositoryId))
      .limit(1);

    if (!existingRepo) {
      throw new Error("Forge repository not found");
    }

    if (existingRepo.workspaceId !== project.workspaceId) {
      throw new Error("Forge repository workspace mismatch");
    }

    await db
      .update(projects)
      .set({ forgeRepositoryId: params.forgeRepositoryId, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    return;
  }

  if (!params.createForgeRepository) {
    return;
  }

  const repoName = params.forgeRepositoryName?.trim() || `${project.id}`;
  const [repo] = await db
    .insert(forgeRepositories)
    .values({
      workspaceId: project.workspaceId,
      name: repoName,
      storageBackend: params.forgeStorageBackend ?? "s3",
      storagePrefix: makeForgeStoragePrefix(
        project.workspaceId,
        project.id,
        params.forgeStoragePrefix
      ),
    })
    .returning();

  if (!repo) {
    throw new Error("Failed to create forge repository");
  }

  await db
    .update(projects)
    .set({ forgeRepositoryId: repo.id, updatedAt: new Date() })
    .where(eq(projects.id, project.id));
}

export const projectRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        status: projectStatusEnum.optional(),
        teamId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .select({
          project: projects,
          lead: {
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(projects)
        .leftJoin(users, eq(projects.leadId, users.id))
        .where(eq(projects.workspaceId, input.workspaceId))
        .$dynamic();

      if (input.status) {
        query = query.where(
          and(eq(projects.workspaceId, input.workspaceId), eq(projects.status, input.status))
        );
      }

      if (input.teamId) {
        query = query
          .innerJoin(projectTeams, eq(projects.id, projectTeams.projectId))
          .where(
            and(eq(projects.workspaceId, input.workspaceId), eq(projectTeams.teamId, input.teamId))
          );
      }

      const baseResult = await query.orderBy(projects.sortOrder, projects.name);

      const enrichedResults = await Promise.all(
        baseResult.map(async (item) => {
          const [issueStats] = await ctx.db
            .select({
              total: count(),
              completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
              inProgress: sql<number>`count(*) filter (where ${issues.status} = 'in_progress')`,
            })
            .from(issues)
            .where(eq(issues.projectId, item.project.id));

          const projectTeamsList = await ctx.db
            .select({ team: teams })
            .from(projectTeams)
            .innerJoin(teams, eq(projectTeams.teamId, teams.id))
            .where(eq(projectTeams.projectId, item.project.id));

          return {
            project: item.project,
            lead: item.lead,
            issueCount: issueStats?.total ?? 0,
            completedCount: issueStats?.completed ?? 0,
            inProgressCount: issueStats?.inProgress ?? 0,
            teams: projectTeamsList.map((pt) => pt.team),
          };
        })
      );

      return enrichedResults;
    }),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await ctx.db
      .select({
        project: projects,
        lead: {
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(projects)
      .leftJoin(users, eq(projects.leadId, users.id))
      .where(eq(projects.id, input.id))
      .limit(1);

    if (!project) return null;

    const projectTeamsList = await ctx.db
      .select({ team: teams })
      .from(projectTeams)
      .innerJoin(teams, eq(projectTeams.teamId, teams.id))
      .where(eq(projectTeams.projectId, input.id));

    const [issueStats] = await ctx.db
      .select({
        total: count(),
        completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
        inProgress: sql<number>`count(*) filter (where ${issues.status} = 'in_progress')`,
        backlog: sql<number>`count(*) filter (where ${issues.status} = 'backlog')`,
      })
      .from(issues)
      .where(eq(issues.projectId, input.id));

    const linkedRepos = await ctx.db
      .select()
      .from(integrationRepos)
      .where(eq(integrationRepos.projectId, input.id));

    return {
      project: project.project,
      lead: project.lead,
      teams: projectTeamsList.map((pt) => pt.team),
      issueCount: issueStats?.total ?? 0,
      completedCount: issueStats?.completed ?? 0,
      inProgressCount: issueStats?.inProgress ?? 0,
      backlogCount: issueStats?.backlog ?? 0,
      linkedRepos,
    };
  }),

  getByKey: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), key: z.string() }))
    .query(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.key, input.key)))
        .limit(1);

      return project ?? null;
    }),

  create: protectedProcedure.input(createProjectInput).mutation(async ({ ctx, input }) => {
    const {
      teamIds,
      createForgeRepository,
      forgeRepositoryId,
      forgeRepositoryName,
      forgeRepositoryStorageBackend,
      forgeRepositoryStoragePrefix,
      ...projectData
    } = input;

    const baseKey = projectData.key ?? generateKeyFromName(projectData.name);
    const uniqueKey = await getUniqueKey(ctx.db, projectData.workspaceId, baseKey);

    const [project] = await ctx.db
      .insert(projects)
      .values({
        ...projectData,
        key: uniqueKey,
        color: projectData.color ?? getRandomColor(),
      })
      .returning();

    if (!project) {
      throw new Error("Failed to create project");
    }

    if (teamIds && teamIds.length > 0) {
      await ctx.db.insert(projectTeams).values(
        teamIds.map((teamId) => ({
          projectId: project.id,
          teamId,
        }))
      );
    }

    await ensureProjectForgeRepository(ctx.db, project, {
      createForgeRepository,
      forgeRepositoryId,
      forgeRepositoryName,
      forgeStorageBackend: forgeRepositoryStorageBackend,
      forgeStoragePrefix: forgeRepositoryStoragePrefix,
    });

    return getProjectById(ctx.db, project.id);
  }),

  update: protectedProcedure.input(updateProjectInputSchema).mutation(async ({ ctx, input }) => {
    const {
      id,
      forgeRepositoryId,
      createForgeRepository,
      forgeRepositoryName,
      forgeRepositoryStorageBackend,
      forgeRepositoryStoragePrefix,
      ...projectData
    } = input;

    const updateData = {
      ...projectData,
      ...(forgeRepositoryId !== undefined ? { forgeRepositoryId } : {}),
      updatedAt: new Date(),
    };

    const [project] = await ctx.db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, id))
      .returning();

    if (!project) {
      throw new Error("Project not found");
    }

    await ensureProjectForgeRepository(ctx.db, project, {
      forgeRepositoryId,
      createForgeRepository,
      forgeRepositoryName,
      forgeStorageBackend: forgeRepositoryStorageBackend,
      forgeStoragePrefix: forgeRepositoryStoragePrefix,
    });

    return getProjectById(ctx.db, project.id);
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projects.id, forgeRepositoryId: projects.forgeRepositoryId })
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);

      if (!project) {
        throw new Error("Project not found");
      }

      await tx.delete(projects).where(eq(projects.id, input.id));

      if (project.forgeRepositoryId) {
        const [remaining] = await tx
          .select({ count: count() })
          .from(projects)
          .where(eq(projects.forgeRepositoryId, project.forgeRepositoryId));

        if (Number(remaining?.count ?? 0) === 0) {
          await tx.delete(forgeRepositories).where(eq(forgeRepositories.id, project.forgeRepositoryId));
        }
      }
    });

    return { success: true };
  }),

  linkRepository: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        provider: repositoryProviderEnum,
        fullName: z.string(),
        url: z.string().url(),
        externalId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .update(projects)
        .set({
          repositoryProvider: input.provider,
          repositoryFullName: input.fullName,
          repositoryUrl: input.url,
          repositoryExternalId: input.externalId,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.projectId))
        .returning();

      return project;
    }),

  unlinkRepository: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .update(projects)
        .set({
          repositoryProvider: null,
          repositoryFullName: null,
          repositoryUrl: null,
          repositoryExternalId: null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.projectId))
        .returning();

      return project;
    }),

  getGitActivity: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const projectIssues = await ctx.db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.projectId, input.projectId));

      if (projectIssues.length === 0) return [];

      const issueIds = projectIssues.map((i) => i.id);

      const gitLinks = await ctx.db
        .select({
          link: issueGitLinks,
          issue: {
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
          },
        })
        .from(issueGitLinks)
        .innerJoin(issues, eq(issueGitLinks.issueId, issues.id))
        .where(sql`${issueGitLinks.issueId} = ANY(${issueIds})`)
        .orderBy(sql`${issueGitLinks.createdAt} DESC`)
        .limit(input.limit);

      return gitLinks.map((g) => ({ ...g.link, issue: g.issue }));
    }),

  addTeams: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        teamIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(projectTeams).values(
        input.teamIds.map((teamId) => ({
          projectId: input.projectId,
          teamId,
        }))
      );
      return { success: true };
    }),

  removeTeam: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        teamId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(projectTeams)
        .where(and(eq(projectTeams.projectId, input.projectId), eq(projectTeams.teamId, input.teamId)));
      return { success: true };
    }),

  teams: protectedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const result = await ctx.db
      .select({ team: teams })
      .from(projectTeams)
      .innerJoin(teams, eq(projectTeams.teamId, teams.id))
      .where(eq(projectTeams.projectId, input.projectId));

    return result.map((r) => r.team);
  }),

  updateProgress: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [stats] = await ctx.db
        .select({
          total: count(),
          completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
        })
        .from(issues)
        .where(eq(issues.projectId, input.projectId));

      const progress = stats && stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      const [project] = await ctx.db
        .update(projects)
        .set({ progress, updatedAt: new Date() })
        .where(eq(projects.id, input.projectId))
        .returning();

      return project;
    }),

  getStats: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();

      const [statusCounts] = await ctx.db
        .select({
          total: count(),
          backlog: sql<number>`count(*) filter (where ${issues.status} = 'backlog')`,
          todo: sql<number>`count(*) filter (where ${issues.status} = 'todo')`,
          inProgress: sql<number>`count(*) filter (where ${issues.status} = 'in_progress')`,
          inReview: sql<number>`count(*) filter (where ${issues.status} = 'in_review')`,
          done: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
          canceled: sql<number>`count(*) filter (where ${issues.status} = 'canceled')`,
        })
        .from(issues)
        .where(and(eq(issues.projectId, input.projectId), eq(issues.trashed, false)));

      const [overdueCount] = await ctx.db
        .select({ count: count() })
        .from(issues)
        .where(
          and(
            eq(issues.projectId, input.projectId),
            eq(issues.trashed, false),
            lt(issues.dueDate, now),
            sql`${issues.status} NOT IN ('done', 'canceled')`
          )
        );

      const projectIssueIds = await ctx.db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.projectId, input.projectId));

      const issueIds = projectIssueIds.map((i) => i.id);

      let blockedCount = 0;
      if (issueIds.length > 0) {
        const blockedIssues = await ctx.db
          .select({ blockedIssueId: issueDependencies.blockedIssueId })
          .from(issueDependencies)
          .innerJoin(issues, eq(issueDependencies.blockingIssueId, issues.id))
          .where(
            and(
              sql`${issueDependencies.blockedIssueId} = ANY(ARRAY[${sql.raw(issueIds.map((id) => `'${id}'::uuid`).join(","))}])`,
              sql`${issues.status} NOT IN ('done', 'canceled')`
            )
          );
        blockedCount = blockedIssues.length;
      }

      const recentActivity = await ctx.db
        .select({
          activity: activities,
          user: {
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
          issue: {
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
          },
        })
        .from(activities)
        .innerJoin(issues, eq(activities.issueId, issues.id))
        .leftJoin(users, eq(activities.userId, users.id))
        .where(eq(issues.projectId, input.projectId))
        .orderBy(desc(activities.createdAt))
        .limit(15);

      const projectTeamIds = await ctx.db
        .select({ teamId: projectTeams.teamId })
        .from(projectTeams)
        .where(eq(projectTeams.projectId, input.projectId));

      let activeCycle = null;
      if (projectTeamIds.length > 0) {
        const teamIds = projectTeamIds.map((t) => t.teamId);
        const [cycle] = await ctx.db
          .select({
            cycle: cycles,
            team: { id: teams.id, name: teams.name, color: teams.color },
          })
          .from(cycles)
          .innerJoin(teams, eq(cycles.teamId, teams.id))
          .where(
            and(
              sql`${cycles.teamId} = ANY(ARRAY[${sql.raw(teamIds.map((id) => `'${id}'::uuid`).join(","))}])`,
              eq(cycles.status, "active")
            )
          )
          .limit(1);

        if (cycle) {
          const [cycleStats] = await ctx.db
            .select({
              total: count(),
              completed: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
            })
            .from(issues)
            .where(eq(issues.cycleId, cycle.cycle.id));

          activeCycle = {
            ...cycle.cycle,
            team: cycle.team,
            issueCount: cycleStats?.total ?? 0,
            completedCount: cycleStats?.completed ?? 0,
          };
        }
      }

      return {
        statusCounts: {
          backlog: statusCounts?.backlog ?? 0,
          todo: statusCounts?.todo ?? 0,
          in_progress: statusCounts?.inProgress ?? 0,
          in_review: statusCounts?.inReview ?? 0,
          done: statusCounts?.done ?? 0,
          canceled: statusCounts?.canceled ?? 0,
        },
        total: statusCounts?.total ?? 0,
        overdueCount: overdueCount?.count ?? 0,
        blockedCount,
        activeCycle,
        recentActivity: recentActivity.map((a) => ({
          ...a.activity,
          user: a.user,
          issue: a.issue,
        })),
      };
    }),
});
