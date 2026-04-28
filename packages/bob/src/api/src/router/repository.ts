import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and } from "@bob/db";
import {
  repositories,
  worktrees,
  agentInstances,
  worktreePlans,
  projects,
  workspaceMembers,
  agentTypeEnum,
  planStatusEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

async function assertProjectAccess(db: any, userId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, workspaceId: true },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, project.workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

export const repositoryRouter = {
  list: protectedProcedure.query(async ({ ctx }) => {
    const repos = await ctx.db.query.repositories.findMany({
      where: eq(repositories.userId, ctx.session.user.id),
      orderBy: desc(repositories.createdAt),
      with: {
        worktrees: {
          with: {
            instances: true,
          },
        },
      },
    });
    return repos;
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const repo = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.id, input.id),
          eq(repositories.userId, ctx.session.user.id)
        ),
        with: {
          worktrees: {
            with: {
              instances: true,
            },
          },
        },
      });

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      return repo;
    }),

  add: protectedProcedure
    .input(z.object({ repositoryPath: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [repo] = await ctx.db
        .insert(repositories)
        .values({
          userId: ctx.session.user.id,
          name: input.repositoryPath.split("/").pop() ?? "unknown",
          path: input.repositoryPath,
          branch: "main",
          mainBranch: "main",
        })
        .returning();

      return repo;
    }),

  /** Register a repository from a connected git provider (GitHub/Gitea).
   *  Clones the repo on the host if not already present, then registers it. */
  addFromProvider: protectedProcedure
    .input(
      z.object({
        fullName: z.string(), // e.g., "gmackie/levelforge"
        cloneUrl: z.string(), // e.g., "https://git.gmac.io/gmackie/levelforge.git"
        htmlUrl: z.string(),
        defaultBranch: z.string().default("main"),
        provider: z.string().optional(), // "github" | "gitea"
        instanceUrl: z.string().optional(),
        projectId: z.string().uuid().optional(), // link to planning project
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.projectId) {
        await assertProjectAccess(ctx.db, ctx.session.user.id, input.projectId);
      }

      const [owner, name] = input.fullName.split("/");
      const repoName = name ?? input.fullName;
      const localPath = `/home/${process.env.USER ?? "mackieg"}/repos/${repoName}`;

      // Check if already registered
      const existing = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.userId, ctx.session.user.id),
          eq(repositories.remoteOwner, owner ?? ""),
          eq(repositories.remoteName, repoName),
        ),
      });

      if (existing) {
        return existing;
      }

      // The Go daemon handles git clone on the node when it discovers
      // the registered repo. We just register the metadata here.

      const [repo] = await ctx.db
        .insert(repositories)
        .values({
          userId: ctx.session.user.id,
          name: repoName,
          path: localPath,
          branch: input.defaultBranch,
          mainBranch: input.defaultBranch,
          remoteUrl: input.cloneUrl,
          remoteOwner: owner ?? "",
          remoteName: repoName,
          remoteProvider: input.provider ?? null,
          remoteInstanceUrl: input.instanceUrl ?? null,
          planningProjectId: input.projectId ?? null,
        })
        .returning();

      console.log(
        `[repository] Registered ${input.fullName} at ${localPath}`,
      );

      return repo;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(repositories)
        .where(
          and(
            eq(repositories.id, input.id),
            eq(repositories.userId, ctx.session.user.id)
          )
        );
      return { success: true };
    }),

  refreshMainBranch: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.id, input.id),
          eq(repositories.userId, ctx.session.user.id)
        ),
      });

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      return repo;
    }),

  getWorktrees: protectedProcedure
    .input(z.object({ repositoryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const wts = await ctx.db.query.worktrees.findMany({
        where: and(
          eq(worktrees.repositoryId, input.repositoryId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
        orderBy: desc(worktrees.createdAt),
        with: {
          instances: true,
        },
      });
      return wts;
    }),

  createWorktree: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        branchName: z.string(),
        baseBranch: z.string().optional(),
        agentType: z.enum(agentTypeEnum).optional().default("claude"),
        planning: z
          .object({
            title: z.string().optional(),
            goal: z.string().optional(),
            planningTaskId: z.string().optional(),
            tasks: z
              .array(
                z.object({
                  key: z.string(),
                  content: z.string(),
                  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
                })
              )
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.id, input.repositoryId),
          eq(repositories.userId, ctx.session.user.id)
        ),
      });

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
      }

      const worktreePath = `~/.bob/${repo.name}-${input.branchName}`;

      const [wt] = await ctx.db
        .insert(worktrees)
        .values({
          userId: ctx.session.user.id,
          repositoryId: input.repositoryId,
          path: worktreePath,
          branch: input.branchName,
          preferredAgent: input.agentType,
          isMainWorktree: false,
        })
        .returning();

      if (!wt) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create worktree" });
      }

      if (input.planning) {
        const planningPath = `${worktreePath}/planning.md`;

        // The planning.md file will be written by the Go daemon when it
        // sets up the worktree. We store the content in the DB for now.

        await ctx.db.insert(worktreePlans).values({
          worktreeId: wt.id,
          userId: ctx.session.user.id,
          filePath: planningPath,
          title: input.planning.title,
          goal: input.planning.goal,
          status: "active",
          planningTaskId: input.planning.planningTaskId,
          lastSyncedAt: new Date().toISOString(),
        });
      }

      return wt;
    }),

  getWorktreePlanning: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const plan = await ctx.db.query.worktreePlans.findFirst({
        where: eq(worktreePlans.worktreeId, input.worktreeId),
      });

      const planningPath = plan?.filePath ?? `${wt.path}/planning.md`;

      // File reads now go through the Go daemon, not the old gateway.
      // Return what we have in the DB.
      return {
        exists: !!plan,
        path: planningPath,
        content: null,
        parsed: plan ? { frontmatter: {}, title: plan.title ?? undefined, goal: plan.goal ?? undefined, tasks: [] } : null,
        dbRecord: plan,
      };
    }),

  updateWorktreePlanning: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        content: z.string().optional(),
        title: z.string().optional(),
        goal: z.string().optional(),
        status: z.enum(planStatusEnum).optional(),
        planningTaskId: z.string().optional().nullable(),
        tasks: z
          .array(
            z.object({
              key: z.string(),
              content: z.string(),
              status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      let plan = await ctx.db.query.worktreePlans.findFirst({
        where: eq(worktreePlans.worktreeId, input.worktreeId),
      });

      const planningPath = plan?.filePath ?? `${wt.path}/planning.md`;

      // File writes now go through the Go daemon. The DB record is
      // updated here; the daemon syncs it to disk when it runs.

      if (!plan) {
        const [newPlan] = await ctx.db
          .insert(worktreePlans)
          .values({
            worktreeId: input.worktreeId,
            userId: ctx.session.user.id,
            filePath: planningPath,
            title: input.title,
            goal: input.goal,
            status: input.status ?? "active",
            planningTaskId: input.planningTaskId,
            lastSyncedAt: new Date().toISOString(),
          })
          .returning();
        plan = newPlan;
      } else {
        const updates: Record<string, unknown> = { lastSyncedAt: new Date().toISOString() };
        if (input.title !== undefined) updates.title = input.title;
        if (input.goal !== undefined) updates.goal = input.goal;
        if (input.status !== undefined) updates.status = input.status;
        if (input.planningTaskId !== undefined) {
          updates.planningTaskId = input.planningTaskId;
        }

        const [updated] = await ctx.db
          .update(worktreePlans)
          .set(updates)
          .where(eq(worktreePlans.id, plan.id))
          .returning();
        plan = updated;
      }

      return {
        success: true,
        plan,
        path: planningPath,
      };
    }),

  deleteWorktree: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        force: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      if (input.force) {
        await ctx.db
          .delete(agentInstances)
          .where(eq(agentInstances.worktreeId, input.worktreeId));
      }

      await ctx.db.delete(worktrees).where(eq(worktrees.id, input.worktreeId));

      return { success: true };
    }),

  getWorktreeMergeStatus: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      return { merged: false, hasUncommittedChanges: false };
    }),
} satisfies TRPCRouterRecord;
