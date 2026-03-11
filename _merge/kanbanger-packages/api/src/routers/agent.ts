import { z } from "zod";
import { eq, and, desc, isNull, inArray, sql, not } from "drizzle-orm";
import {
  users,
  issues,
  agentSessions,
  agentTaskRuns,
  activities,
  notifications,
  workspaceMembers,
  issueLabels,
  AgentSessionStatus,
  AgentTaskRunStatus,
  IssueStatus,
} from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

const agentConfigSchema = z.object({
  capabilities: z.array(z.string()).default([]),
  allowedProjects: z.array(z.string().uuid()).default([]),
  allowedLabels: z.array(z.string().uuid()).default([]),
  excludedLabels: z.array(z.string().uuid()).default([]),
  maxConcurrentTasks: z.number().min(1).max(10).default(1),
  autoClaimEnabled: z.boolean().default(false),
  autoClaimCriteria: z
    .object({
      priorities: z.array(z.string()).default([]),
      statuses: z.array(z.string()).default([]),
      maxEstimate: z.number().optional(),
    })
    .optional(),
  avatar: z
    .object({
      primaryColor: z.string(),
      accentColor: z.string(),
      variant: z.enum(["default", "friendly", "technical", "creative"]),
    })
    .optional(),
});

const bobRunStatusEnum = z.enum([
  "claimed",
  "in_progress",
  "completed",
  "failed",
  "failed_to_start",
  "abandoned",
  "handed_off",
  "superseded",
]);

const issueStatusEnum = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);

export function countConsecutiveFailedToStart(
  statuses: string[],
): number {
  let count = 0;

  for (const status of statuses) {
    if (status !== "failed_to_start") {
      break;
    }

    count += 1;
  }

  return count;
}

export const agentRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
          agentConfig: users.agentConfig,
          createdAt: users.createdAt,
        })
        .from(users)
        .innerJoin(workspaceMembers, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(users.isAgent, true)
          )
        )
        .orderBy(users.name);

      return result;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [agent] = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
          agentConfig: users.agentConfig,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.isAgent, true)))
        .limit(1);

      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      return agent;
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(100),
        email: z.string().email(),
        config: agentConfigSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists",
        });
      }

      const [agent] = await ctx.db
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          isAgent: true,
          agentConfig: input.config,
        })
        .returning();

      if (!agent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create agent",
        });
      }

      await ctx.db.insert(workspaceMembers).values({
        workspaceId: input.workspaceId,
        userId: agent.id,
        role: "member",
      });

      return agent;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        config: agentConfigSchema.partial().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [agent] = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.isAgent, true)))
        .limit(1);

      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updateData.name = input.name;
      if (input.config) {
        updateData.agentConfig = { ...agent.agentConfig, ...input.config };
      }

      const [updated] = await ctx.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, input.id))
        .returning();

      return updated;
    }),

  startSession: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        metadata: z
          .object({
            clientInfo: z.string().optional(),
            version: z.string().optional(),
            capabilities: z.array(z.string()).optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existingSession] = await ctx.db
        .select()
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.agentId, input.agentId),
            isNull(agentSessions.endedAt)
          )
        )
        .limit(1);

      if (existingSession) {
        await ctx.db
          .update(agentSessions)
          .set({ endedAt: new Date() })
          .where(eq(agentSessions.id, existingSession.id));
      }

      const [session] = await ctx.db
        .insert(agentSessions)
        .values({
          agentId: input.agentId,
          workspaceId: input.workspaceId,
          status: AgentSessionStatus.IDLE,
          metadata: input.metadata,
        })
        .returning();

      return session;
    }),

  heartbeat: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .update(agentSessions)
        .set({ lastHeartbeatAt: new Date() })
        .where(
          and(
            eq(agentSessions.id, input.sessionId),
            isNull(agentSessions.endedAt)
          )
        )
        .returning();

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found or already ended",
        });
      }

      return session;
    }),

  endSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .update(agentSessions)
        .set({
          status: AgentSessionStatus.IDLE,
          endedAt: new Date(),
          currentIssueId: null,
        })
        .where(eq(agentSessions.id, input.sessionId))
        .returning();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      return session;
    }),

  claimTask: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        issueId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [issue] = await ctx.db
        .select()
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .limit(1);

      if (!issue) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Issue not found" });
      }

      if (issue.assigneeId && issue.assigneeId !== input.agentId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Issue is already assigned to another user",
        });
      }

      const [existingRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(
          and(
            eq(agentTaskRuns.issueId, input.issueId),
            inArray(agentTaskRuns.status, [
              AgentTaskRunStatus.CLAIMED,
              AgentTaskRunStatus.IN_PROGRESS,
            ])
          )
        )
        .limit(1);

      if (existingRun) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Issue already has an active agent task run",
        });
      }

      await ctx.db
        .update(issues)
        .set({ assigneeId: input.agentId, updatedAt: new Date() })
        .where(eq(issues.id, input.issueId));

      const [taskRun] = await ctx.db
        .insert(agentTaskRuns)
        .values({
          agentId: input.agentId,
          issueId: input.issueId,
          sessionId: input.sessionId,
          status: AgentTaskRunStatus.CLAIMED,
        })
        .returning();

      if (input.sessionId) {
        await ctx.db
          .update(agentSessions)
          .set({
            status: AgentSessionStatus.WORKING,
            currentIssueId: input.issueId,
          })
          .where(eq(agentSessions.id, input.sessionId));
      }

      await ctx.db.insert(activities).values({
        issueId: input.issueId,
        userId: input.agentId,
        type: "agent_claimed",
        metadata: { taskRunId: taskRun?.id },
      });

      return taskRun;
    }),

  reportProgress: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        progress: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [taskRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .limit(1);

      if (!taskRun) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task run not found",
        });
      }

      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${input.progress}\n`;
      const newLog = (taskRun.progressLog || "") + logEntry;

      const updateData: Record<string, unknown> = { progressLog: newLog };
      if (taskRun.status === AgentTaskRunStatus.CLAIMED) {
        updateData.status = AgentTaskRunStatus.IN_PROGRESS;
        updateData.startedAt = new Date();
      }

      const [updated] = await ctx.db
        .update(agentTaskRuns)
        .set(updateData)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .returning();

      await ctx.db.insert(activities).values({
        issueId: taskRun.issueId,
        userId: taskRun.agentId,
        type: "agent_progress",
        metadata: { taskRunId: taskRun.id, progress: input.progress },
      });

      return updated;
    }),

  syncBobRun: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        taskRunId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        executionBackend: z.literal("bob").default("bob"),
        externalSessionId: z.string().optional(),
        externalSessionUrl: z.string().url().optional(),
        sessionStatus: z.enum(["idle", "working", "paused"]).optional(),
        workflowStatus: z.string().optional(),
        runStatus: bobRunStatusEnum.optional(),
        latestSummary: z.string().optional(),
        lastPromptCommentId: z.string().uuid().optional(),
        reviewUrl: z.string().url().optional(),
        artifactRefs: z
          .array(
            z.object({
              type: z.string(),
              url: z.string().url(),
              title: z.string().optional(),
              summary: z.string().optional(),
            })
          )
          .optional(),
        completionSource: z.string().optional(),
        issueStatus: issueStatusEnum.optional(),
        idempotencyKey: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [taskRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .limit(1);

      if (!taskRun || taskRun.issueId !== input.issueId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bob run not found",
        });
      }

      const existingActivities = await ctx.db
        .select()
        .from(activities)
        .where(eq(activities.issueId, input.issueId));

      const duplicateActivity = existingActivities.find(
        (activity) =>
          (activity.metadata as Record<string, unknown> | null | undefined)
            ?.idempotencyKey === input.idempotencyKey
      );

      if (duplicateActivity) {
        return {
          taskRun,
          sessionId: input.sessionId ?? taskRun.sessionId ?? null,
          duplicated: true,
        };
      }

      const now = new Date();
      const nextRunStatus = input.runStatus ?? taskRun.status;
      const runUpdate: Record<string, unknown> = {
        executionBackend: input.executionBackend,
        sessionId: input.sessionId ?? taskRun.sessionId,
        latestSummary: input.latestSummary ?? taskRun.latestSummary,
        lastPromptCommentId:
          input.lastPromptCommentId ?? taskRun.lastPromptCommentId,
        externalSessionId: input.externalSessionId ?? taskRun.externalSessionId,
        externalSessionUrl:
          input.externalSessionUrl ?? taskRun.externalSessionUrl,
        reviewUrl: input.reviewUrl ?? taskRun.reviewUrl,
        artifactRefs: input.artifactRefs ?? taskRun.artifactRefs,
        completionSource: input.completionSource ?? taskRun.completionSource,
      };

      if (input.runStatus) {
        runUpdate.status = input.runStatus;
      }
      if (input.runStatus === "in_progress" && !taskRun.startedAt) {
        runUpdate.startedAt = now;
      }
      if (
        input.runStatus &&
        ["completed", "failed", "failed_to_start", "abandoned", "handed_off", "superseded"].includes(
          input.runStatus
        )
      ) {
        runUpdate.completedAt = now;
      }

      const [updatedTaskRun] = await ctx.db
        .update(agentTaskRuns)
        .set(runUpdate)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .returning();

      const effectiveSessionId = input.sessionId ?? taskRun.sessionId ?? null;
      let updatedSession = null;

      if (effectiveSessionId) {
        const sessionUpdate: Record<string, unknown> = {
          executionBackend: input.executionBackend,
          lastSyncedAt: now,
        };

        if (input.externalSessionId !== undefined) {
          sessionUpdate.externalSessionId = input.externalSessionId;
        }
        if (input.externalSessionUrl !== undefined) {
          sessionUpdate.externalSessionUrl = input.externalSessionUrl;
        }
        if (input.workflowStatus !== undefined) {
          sessionUpdate.workflowStatus = input.workflowStatus;
        }

        if (input.sessionStatus) {
          sessionUpdate.status = input.sessionStatus;
          sessionUpdate.currentIssueId =
            input.sessionStatus === "idle" ? null : input.issueId;
        }

        [updatedSession] = await ctx.db
          .update(agentSessions)
          .set(sessionUpdate)
          .where(eq(agentSessions.id, effectiveSessionId))
          .returning();
      }

      if (input.issueStatus) {
        await ctx.db
          .update(issues)
          .set({
            status: input.issueStatus,
            updatedAt: now,
          })
          .where(eq(issues.id, input.issueId))
          .returning();
      }

      const activityType =
        nextRunStatus === "completed"
          ? "agent_completed"
          : nextRunStatus === "failed" || nextRunStatus === "failed_to_start"
            ? "agent_failed"
            : nextRunStatus === "handed_off"
              ? "agent_handed_off"
              : taskRun.status !== "in_progress" && nextRunStatus === "in_progress"
                ? "agent_started"
                : "agent_progress";

      await ctx.db.insert(activities).values({
        issueId: input.issueId,
        userId: taskRun.agentId,
        type: activityType,
        metadata: {
          taskRunId: taskRun.id,
          executionBackend: input.executionBackend,
          idempotencyKey: input.idempotencyKey,
          workflowStatus: input.workflowStatus,
          latestSummary: input.latestSummary,
          externalSessionId: input.externalSessionId,
          externalSessionUrl: input.externalSessionUrl,
          lastPromptCommentId: input.lastPromptCommentId,
          reviewUrl: input.reviewUrl,
        },
      });

      const [issueOwner] = await ctx.db
        .select({
          creatorId: issues.creatorId,
          identifier: issues.identifier,
          title: issues.title,
        })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .limit(1);

      if (issueOwner?.creatorId) {
        if (input.workflowStatus === "awaiting_input") {
          await ctx.db.insert(notifications).values({
            userId: issueOwner.creatorId,
            type: "agent_needs_input",
            issueId: input.issueId,
            actorId: taskRun.agentId,
            title: `Bob needs input on ${issueOwner.identifier}`,
            body:
              input.latestSummary ??
              "Bob is waiting for a human decision before continuing.",
          });
        }

        if (input.issueStatus === "in_review") {
          await ctx.db.insert(notifications).values({
            userId: issueOwner.creatorId,
            type: "issue_status_changed",
            issueId: input.issueId,
            actorId: taskRun.agentId,
            title: `Bob marked ${issueOwner.identifier} ready for review`,
            body:
              input.latestSummary ??
              "Bob finished implementation and moved the issue into review.",
          });
        }

        if (input.runStatus === "failed_to_start") {
          const recentRunStatuses = await ctx.db
            .select({ status: agentTaskRuns.status })
            .from(agentTaskRuns)
            .where(
              and(
                eq(agentTaskRuns.issueId, input.issueId),
                eq(agentTaskRuns.executionBackend, "bob"),
              ),
            )
            .orderBy(desc(agentTaskRuns.claimedAt))
            .limit(5);

          if (
            countConsecutiveFailedToStart(
              recentRunStatuses.map((run) => run.status),
            ) >= 2
          ) {
            await ctx.db.insert(notifications).values({
              userId: issueOwner.creatorId,
              type: "agent_failed_task",
              issueId: input.issueId,
              actorId: taskRun.agentId,
              title: `Bob failed to start repeatedly for ${issueOwner.identifier}`,
              body:
                input.latestSummary ??
                "Bob could not start this issue in two consecutive attempts.",
            });
          }
        }
      }

      return {
        taskRun: updatedTaskRun ?? taskRun,
        session: updatedSession,
        duplicated: false,
      };
    }),

  completeTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        result: z.object({
          success: z.literal(true),
          summary: z.string().optional(),
          artifacts: z
            .array(
              z.object({
                type: z.enum(["pr", "commit", "file", "comment"]),
                url: z.string().optional(),
                description: z.string().optional(),
              })
            )
            .optional(),
        }),
        markIssueDone: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [taskRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .limit(1);

      if (!taskRun) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task run not found",
        });
      }

      const [updated] = await ctx.db
        .update(agentTaskRuns)
        .set({
          status: AgentTaskRunStatus.COMPLETED,
          completedAt: new Date(),
          result: input.result,
        })
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .returning();

      if (input.markIssueDone) {
        await ctx.db
          .update(issues)
          .set({
            status: IssueStatus.DONE,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(issues.id, taskRun.issueId));
      }

      if (taskRun.sessionId) {
        await ctx.db
          .update(agentSessions)
          .set({
            status: AgentSessionStatus.IDLE,
            currentIssueId: null,
          })
          .where(eq(agentSessions.id, taskRun.sessionId));
      }

      await ctx.db.insert(activities).values({
        issueId: taskRun.issueId,
        userId: taskRun.agentId,
        type: "agent_completed",
        metadata: { taskRunId: taskRun.id, result: input.result },
      });

      const [issue] = await ctx.db
        .select({ creatorId: issues.creatorId })
        .from(issues)
        .where(eq(issues.id, taskRun.issueId))
        .limit(1);

      if (issue?.creatorId) {
        await ctx.db.insert(notifications).values({
          userId: issue.creatorId,
          type: "agent_completed_task",
          issueId: taskRun.issueId,
          actorId: taskRun.agentId,
          title: "Agent completed task",
          body: input.result.summary || "Task completed successfully",
        });
      }

      return updated;
    }),

  failTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        error: z.object({
          code: z.string(),
          message: z.string(),
          recoverable: z.boolean().default(false),
        }),
        returnToBacklog: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [taskRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .limit(1);

      if (!taskRun) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task run not found",
        });
      }

      const [updated] = await ctx.db
        .update(agentTaskRuns)
        .set({
          status: AgentTaskRunStatus.FAILED,
          completedAt: new Date(),
          result: { success: false, error: input.error },
        })
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .returning();

      if (input.returnToBacklog) {
        await ctx.db
          .update(issues)
          .set({
            status: IssueStatus.BACKLOG,
            assigneeId: null,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, taskRun.issueId));
      }

      if (taskRun.sessionId) {
        await ctx.db
          .update(agentSessions)
          .set({
            status: AgentSessionStatus.IDLE,
            currentIssueId: null,
          })
          .where(eq(agentSessions.id, taskRun.sessionId));
      }

      await ctx.db.insert(activities).values({
        issueId: taskRun.issueId,
        userId: taskRun.agentId,
        type: "agent_failed",
        metadata: { taskRunId: taskRun.id, error: input.error },
      });

      const [issue] = await ctx.db
        .select({ creatorId: issues.creatorId })
        .from(issues)
        .where(eq(issues.id, taskRun.issueId))
        .limit(1);

      if (issue?.creatorId) {
        await ctx.db.insert(notifications).values({
          userId: issue.creatorId,
          type: "agent_failed_task",
          issueId: taskRun.issueId,
          actorId: taskRun.agentId,
          title: "Agent failed task",
          body: input.error.message,
        });
      }

      return updated;
    }),

  handOffTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        handOffToUserId: z.string().uuid(),
        reason: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [taskRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .limit(1);

      if (!taskRun) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task run not found",
        });
      }

      const [updated] = await ctx.db
        .update(agentTaskRuns)
        .set({
          status: AgentTaskRunStatus.HANDED_OFF,
          completedAt: new Date(),
          handedOffTo: input.handOffToUserId,
          handoffReason: input.reason,
        })
        .where(eq(agentTaskRuns.id, input.taskRunId))
        .returning();

      await ctx.db
        .update(issues)
        .set({
          assigneeId: input.handOffToUserId,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, taskRun.issueId));

      if (taskRun.sessionId) {
        await ctx.db
          .update(agentSessions)
          .set({
            status: AgentSessionStatus.IDLE,
            currentIssueId: null,
          })
          .where(eq(agentSessions.id, taskRun.sessionId));
      }

      await ctx.db.insert(activities).values({
        issueId: taskRun.issueId,
        userId: taskRun.agentId,
        type: "agent_handed_off",
        metadata: {
          taskRunId: taskRun.id,
          handedOffTo: input.handOffToUserId,
          reason: input.reason,
        },
      });

      await ctx.db.insert(notifications).values({
        userId: input.handOffToUserId,
        type: "issue_assigned",
        issueId: taskRun.issueId,
        actorId: taskRun.agentId,
        title: "Agent handed off task to you",
        body: input.reason,
      });

      return updated;
    }),

  getAvailableTasks: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const [agent] = await ctx.db
        .select({ agentConfig: users.agentConfig })
        .from(users)
        .where(and(eq(users.id, input.agentId), eq(users.isAgent, true)))
        .limit(1);

      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      const config = agent.agentConfig;

      let query = ctx.db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          description: issues.description,
          status: issues.status,
          priority: issues.priority,
          estimate: issues.estimate,
          projectId: issues.projectId,
          createdAt: issues.createdAt,
        })
        .from(issues)
        .where(
          and(
            isNull(issues.assigneeId),
            not(eq(issues.status, IssueStatus.DONE)),
            not(eq(issues.status, IssueStatus.CANCELED)),
            eq(issues.trashed, false),
            config?.allowedProjects && config.allowedProjects.length > 0
              ? inArray(issues.projectId, config.allowedProjects)
              : undefined
          )
        )
        .orderBy(
          sql`CASE 
            WHEN ${issues.priority} = 'urgent' THEN 1
            WHEN ${issues.priority} = 'high' THEN 2
            WHEN ${issues.priority} = 'medium' THEN 3
            WHEN ${issues.priority} = 'low' THEN 4
            ELSE 5
          END`,
          desc(issues.createdAt)
        )
        .limit(input.limit);

      const result = await query;

      if (config?.excludedLabels && config.excludedLabels.length > 0) {
        const issueIds = result.map((i) => i.id);
        if (issueIds.length > 0) {
          const excludedIssues = await ctx.db
            .select({ issueId: issueLabels.issueId })
            .from(issueLabels)
            .where(
              and(
                inArray(issueLabels.issueId, issueIds),
                inArray(issueLabels.labelId, config.excludedLabels)
              )
            );

          const excludedIds = new Set(excludedIssues.map((e) => e.issueId));
          return result.filter((i) => !excludedIds.has(i.id));
        }
      }

      return result;
    }),

  getAgentActivity: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.db
        .select({
          id: agentTaskRuns.id,
          issueId: agentTaskRuns.issueId,
          status: agentTaskRuns.status,
          claimedAt: agentTaskRuns.claimedAt,
          startedAt: agentTaskRuns.startedAt,
          completedAt: agentTaskRuns.completedAt,
          result: agentTaskRuns.result,
        })
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.agentId, input.agentId))
        .orderBy(desc(agentTaskRuns.claimedAt))
        .limit(input.limit);

      return result;
    }),

  getWorkspaceAgentStats: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const agentList = await ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .innerJoin(workspaceMembers, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(users.isAgent, true)
          )
        );

      const agentIds = agentList.map((a) => a.id);
      if (agentIds.length === 0) {
        return { agents: [], totalCompleted: 0, totalFailed: 0, activeNow: 0 };
      }

      const stats = await ctx.db
        .select({
          agentId: agentTaskRuns.agentId,
          status: agentTaskRuns.status,
          count: sql<number>`count(*)::int`,
        })
        .from(agentTaskRuns)
        .where(inArray(agentTaskRuns.agentId, agentIds))
        .groupBy(agentTaskRuns.agentId, agentTaskRuns.status);

      const activeSessions = await ctx.db
        .select({ agentId: agentSessions.agentId })
        .from(agentSessions)
        .where(
          and(
            inArray(agentSessions.agentId, agentIds),
            isNull(agentSessions.endedAt),
            eq(agentSessions.status, AgentSessionStatus.WORKING)
          )
        );

      const activeAgentIds = new Set(activeSessions.map((s) => s.agentId));

      const agentStatsMap = new Map<
        string,
        { completed: number; failed: number; inProgress: number }
      >();
      for (const stat of stats) {
        const current = agentStatsMap.get(stat.agentId) || {
          completed: 0,
          failed: 0,
          inProgress: 0,
        };
        if (stat.status === AgentTaskRunStatus.COMPLETED) {
          current.completed = stat.count;
        } else if (stat.status === AgentTaskRunStatus.FAILED) {
          current.failed = stat.count;
        } else if (
          stat.status === AgentTaskRunStatus.IN_PROGRESS ||
          stat.status === AgentTaskRunStatus.CLAIMED
        ) {
          current.inProgress += stat.count;
        }
        agentStatsMap.set(stat.agentId, current);
      }

      const agentsWithStats = agentList.map((agent) => ({
        id: agent.id,
        name: agent.name,
        isActive: activeAgentIds.has(agent.id),
        ...(agentStatsMap.get(agent.id) || {
          completed: 0,
          failed: 0,
          inProgress: 0,
        }),
      }));

      const totalCompleted = agentsWithStats.reduce(
        (sum, a) => sum + a.completed,
        0
      );
      const totalFailed = agentsWithStats.reduce((sum, a) => sum + a.failed, 0);
      const activeNow = activeAgentIds.size;

      return { agents: agentsWithStats, totalCompleted, totalFailed, activeNow };
    }),

  getCurrentSession: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.agentId, input.agentId),
            isNull(agentSessions.endedAt)
          )
        )
        .orderBy(desc(agentSessions.startedAt))
        .limit(1);

      return session || null;
    }),

  listIssueRuns: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        limit: z.number().min(1).max(20).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const runs = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(
          and(
            eq(agentTaskRuns.issueId, input.issueId),
            eq(agentTaskRuns.executionBackend, "bob")
          )
        )
        .orderBy(desc(agentTaskRuns.claimedAt))
        .limit(input.limit);

      const sessionIds = runs
        .map((run) => run.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId));

      const sessions =
        sessionIds.length > 0
          ? await ctx.db
              .select()
              .from(agentSessions)
              .where(inArray(agentSessions.id, sessionIds))
          : [];

      const sessionsById = new Map(sessions.map((session) => [session.id, session]));

      return runs.map((run) => ({
        ...run,
        session: run.sessionId ? sessionsById.get(run.sessionId) ?? null : null,
      }));
    }),

  getTaskRun: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [taskRun] = await ctx.db
        .select()
        .from(agentTaskRuns)
        .where(eq(agentTaskRuns.id, input.id))
        .limit(1);

      if (!taskRun) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task run not found",
        });
      }

      return taskRun;
    }),
});
