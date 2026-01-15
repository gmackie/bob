import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and } from "@bob/db";
import {
  repositories,
  worktrees,
  agentInstances,
  worktreePlans,
  CreateRepositorySchema,
  agentTypeEnum,
  planStatusEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

async function gatewayRequest(
  userId: string,
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, ...body }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Gateway error: ${error}`,
    });
  }

  return response.json();
}

function generatePlanningMd(options: {
  title?: string;
  goal?: string;
  kanbangerTaskId?: string;
  worktreeId: string;
  tasks?: Array<{ key: string; content: string; status?: string }>;
}): string {
  const lines: string[] = [];
  
  lines.push("---");
  lines.push(`bob_worktree_id: ${options.worktreeId}`);
  if (options.kanbangerTaskId) {
    lines.push(`kanbanger_task_id: ${options.kanbangerTaskId}`);
  }
  lines.push(`created_at: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  
  if (options.title) {
    lines.push(`# ${options.title}`);
    lines.push("");
  }
  
  if (options.goal) {
    lines.push("## Goal");
    lines.push("");
    lines.push(options.goal);
    lines.push("");
  }
  
  lines.push("## Tasks");
  lines.push("");
  
  if (options.tasks && options.tasks.length > 0) {
    for (const task of options.tasks) {
      const checkbox = task.status === "completed" ? "[x]" : "[ ]";
      lines.push(`- ${checkbox} **${task.key}**: ${task.content}`);
    }
  } else {
    lines.push("- [ ] **T1**: Define task here");
  }
  lines.push("");
  
  lines.push("## Progress Log");
  lines.push("");
  lines.push(`- ${new Date().toISOString().split("T")[0]}: Plan created`);
  lines.push("");
  
  lines.push("## Notes");
  lines.push("");
  
  return lines.join("\n");
}

function parsePlanningMd(content: string): {
  frontmatter: Record<string, string>;
  title?: string;
  goal?: string;
  tasks: Array<{ key: string; content: string; completed: boolean }>;
} {
  const result: {
    frontmatter: Record<string, string>;
    title?: string;
    goal?: string;
    tasks: Array<{ key: string; content: string; completed: boolean }>;
  } = {
    frontmatter: {},
    tasks: [],
  };
  
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch && fmMatch[1]) {
    const fmLines = fmMatch[1].split("\n");
    for (const line of fmLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        result.frontmatter[key] = value;
      }
    }
  }
  
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    result.title = titleMatch[1].trim();
  }
  
  const goalMatch = content.match(/## Goal\s*\n\n([\s\S]*?)(?=\n## |\n---|\n$)/);
  if (goalMatch && goalMatch[1]) {
    result.goal = goalMatch[1].trim();
  }
  
  const taskMatches = content.matchAll(/- \[([ x])\] \*\*([^*]+)\*\*:\s*(.+)/g);
  for (const match of taskMatches) {
    const key = match[2];
    const taskContent = match[3];
    const completed = match[1];
    if (key && taskContent && completed !== undefined) {
      result.tasks.push({
        key: key.trim(),
        content: taskContent.trim(),
        completed: completed === "x",
      });
    }
  }
  
  return result;
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
            kanbangerTaskId: z.string().optional(),
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
        const planningContent = generatePlanningMd({
          title: input.planning.title,
          goal: input.planning.goal,
          kanbangerTaskId: input.planning.kanbangerTaskId,
          worktreeId: wt.id,
          tasks: input.planning.tasks,
        });

        const planningPath = `${worktreePath}/planning.md`;

        try {
          await gatewayRequest(ctx.session.user.id, "/fs/write", {
            path: planningPath,
            content: planningContent,
            createDirs: true,
          });
        } catch (error) {
          console.error("Failed to write planning.md:", error);
        }

        await ctx.db.insert(worktreePlans).values({
          worktreeId: wt.id,
          userId: ctx.session.user.id,
          filePath: planningPath,
          title: input.planning.title,
          goal: input.planning.goal,
          status: "active",
          kanbangerTaskId: input.planning.kanbangerTaskId,
          lastSyncedAt: new Date(),
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

      try {
        const result = await gatewayRequest(ctx.session.user.id, "/fs/read", {
          path: planningPath,
        }) as { content: string; size: number };

        const parsed = parsePlanningMd(result.content);

        return {
          exists: true,
          path: planningPath,
          content: result.content,
          parsed,
          dbRecord: plan,
        };
      } catch {
        return {
          exists: false,
          path: planningPath,
          content: null,
          parsed: null,
          dbRecord: plan,
        };
      }
    }),

  updateWorktreePlanning: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        content: z.string().optional(),
        title: z.string().optional(),
        goal: z.string().optional(),
        status: z.enum(planStatusEnum).optional(),
        kanbangerTaskId: z.string().optional().nullable(),
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

      let contentToWrite = input.content;

      if (!contentToWrite && (input.title || input.goal || input.tasks)) {
        contentToWrite = generatePlanningMd({
          title: input.title ?? plan?.title ?? undefined,
          goal: input.goal ?? plan?.goal ?? undefined,
          kanbangerTaskId: input.kanbangerTaskId ?? plan?.kanbangerTaskId ?? undefined,
          worktreeId: input.worktreeId,
          tasks: input.tasks,
        });
      }

      if (contentToWrite) {
        await gatewayRequest(ctx.session.user.id, "/fs/write", {
          path: planningPath,
          content: contentToWrite,
          createDirs: true,
        });
      }

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
            kanbangerTaskId: input.kanbangerTaskId,
            lastSyncedAt: new Date(),
          })
          .returning();
        plan = newPlan;
      } else {
        const updates: Record<string, unknown> = { lastSyncedAt: new Date() };
        if (input.title !== undefined) updates.title = input.title;
        if (input.goal !== undefined) updates.goal = input.goal;
        if (input.status !== undefined) updates.status = input.status;
        if (input.kanbangerTaskId !== undefined) updates.kanbangerTaskId = input.kanbangerTaskId;

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
