import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  planningListWorkspaces,
  planningListProjects,
  planningGetProject,
  planningListTasks,
  planningGetTask,
  planningGetTaskByIdentifier,
  planningCreateTask,
  planningUpdateTask,
  planningAddComment,
  planningListComments,
  planningSearchTasks,
  planningListLabels,
  planningListCycles,
  planningGetCurrentUser,
  planningAgentClaimTask,
  planningAgentReportProgress,
  planningAgentCompleteTask,
  planningAgentFailTask,
  planningAgentGetAvailableTasks,
  planningAgentStartSession,
  planningAgentEndSession,
} from "../handlers/planning";

const taskStatusEnum = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
const taskPriorityEnum = [
  "no_priority",
  "urgent",
  "high",
  "medium",
  "low",
] as const;

export const planningRouter = {
  listWorkspaces: protectedProcedure.query(({ ctx }) =>
    planningListWorkspaces({ db: ctx.db, userId: ctx.session.user.id }, undefined as void),
  ),

  listProjects: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planningListProjects({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getProject: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planningGetProject({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listTasks: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        status: z.enum(taskStatusEnum).optional(),
        priority: z.enum(taskPriorityEnum).optional(),
        assigneeId: z.string().uuid().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(({ ctx, input }) =>
      planningListTasks({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getTask: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planningGetTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getTaskByIdentifier: protectedProcedure
    .input(
      z.object({
        identifier: z.string(),
        workspaceId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      planningGetTaskByIdentifier({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createTask: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        kind: z.enum(["issue", "epic", "task"]).default("task"),
        status: z
          .enum(["backlog", "todo", "in_progress", "in_review", "done"])
          .default("todo"),
        priority: z.enum(taskPriorityEnum).default("no_priority"),
        assigneeId: z.string().uuid().optional(),
        labelIds: z.array(z.string().uuid()).optional(),
        dueDate: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningCreateTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateTask: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(taskStatusEnum).optional(),
        priority: z.enum(taskPriorityEnum).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningUpdateTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  addComment: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        body: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningAddComment({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listComments: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        includeReplies: z.boolean().default(true),
      }),
    )
    .query(({ ctx, input }) =>
      planningListComments({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  searchTasks: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        query: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      planningSearchTasks({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listLabels: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planningListLabels({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listCycles: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        status: z.enum(["upcoming", "active", "completed"]).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      planningListCycles({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getCurrentUser: protectedProcedure.query(({ ctx }) =>
    planningGetCurrentUser(
      {
        db: ctx.db,
        userId: ctx.session.user.id,
        session: ctx.session,
      },
      undefined as void,
    ),
  ),

  agentClaimTask: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        issueId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningAgentClaimTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  agentReportProgress: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        progress: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningAgentReportProgress({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  agentCompleteTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        summary: z.string().optional(),
        artifacts: z
          .array(
            z.object({
              type: z.enum(["pr", "commit", "file", "comment"]),
              url: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
        markIssueDone: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningAgentCompleteTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  agentFailTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        errorCode: z.string(),
        errorMessage: z.string(),
        recoverable: z.boolean().default(false),
        returnToBacklog: z.boolean().default(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningAgentFailTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  agentGetAvailableTasks: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(({ ctx, input }) =>
      planningAgentGetAvailableTasks({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  agentStartSession: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        clientInfo: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planningAgentStartSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  agentEndSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      planningAgentEndSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
