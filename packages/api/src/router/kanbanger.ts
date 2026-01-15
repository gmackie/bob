import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

const KANBANGER_URL = process.env.KANBANGER_URL ?? "https://tasks.gmac.io";
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

async function kanbangerRequest<T>(
  path: string,
  input?: unknown
): Promise<T> {
  if (!KANBANGER_API_KEY) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "KANBANGER_API_KEY not configured",
    });
  }

  const url = `${KANBANGER_URL}/api/trpc/${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": KANBANGER_API_KEY,
    },
    body: JSON.stringify(input ? { "0": { json: input } } : { "0": { json: {} } }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Kanbanger API error: ${text}`,
    });
  }

  const result = await response.json() as Array<{ result?: { data?: { json?: T } }; error?: { message?: string } }>;
  if (result[0]?.error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result[0].error.message ?? "Kanbanger error",
    });
  }

  return result[0]?.result?.data?.json as T;
}

const taskStatusEnum = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
const taskPriorityEnum = ["no_priority", "urgent", "high", "medium", "low"] as const;

export const kanbangerRouter = {
  listWorkspaces: protectedProcedure.query(async () => {
    return kanbangerRequest<Array<{ id: string; name: string; slug: string }>>(
      "workspace.list"
    );
  }),

  listProjects: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ input }) => {
      return kanbangerRequest<Array<{
        project: { id: string; name: string; key: string; status: string; color: string };
        issueCount: number;
        completedCount: number;
      }>>("project.list", input);
    }),

  getProject: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return kanbangerRequest<{
        project: { id: string; name: string; key: string; description?: string; status: string; color: string };
        issueCount: number;
        completedCount: number;
        inProgressCount: number;
        backlogCount: number;
      }>("project.get", input);
    }),

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
      })
    )
    .query(async ({ input }) => {
      const { workspaceId, projectId, status, priority, assigneeId, search, limit } = input;
      return kanbangerRequest<Array<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
        project?: { id: string; name: string; key: string };
        assignee?: { id: string; name: string };
        labels?: Array<{ id: string; name: string; color: string }>;
        dueDate?: string;
        createdAt: string;
        updatedAt: string;
      }>>("issue.list", {
        workspaceId,
        filter: {
          projectId,
          status: status ? [status] : undefined,
          priority: priority ? [priority] : undefined,
          assigneeId,
          search,
        },
        pagination: {
          limit,
          offset: 0,
          sortBy: "updatedAt",
          sortDirection: "desc",
        },
      });
    }),

  getTask: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        project?: { id: string; name: string; key: string };
        assignee?: { id: string; name: string };
        labels?: Array<{ id: string; name: string; color: string }>;
        dueDate?: string;
        createdAt: string;
        updatedAt: string;
        completedAt?: string;
      }>("issue.get", input);
    }),

  getTaskByIdentifier: protectedProcedure
    .input(z.object({ identifier: z.string(), workspaceId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        projectId: string;
        dueDate?: string;
      }>("issue.getByIdentifier", input);
    }),

  createTask: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["backlog", "todo", "in_progress", "in_review", "done"]).default("todo"),
        priority: z.enum(taskPriorityEnum).default("no_priority"),
        assigneeId: z.string().uuid().optional(),
        labelIds: z.array(z.string().uuid()).optional(),
        dueDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
      }>("issue.create", {
        ...input,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      });
    }),

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
      })
    )
    .mutation(async ({ input }) => {
      const { dueDate, ...rest } = input;
      return kanbangerRequest<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
      }>("issue.update", {
        ...rest,
        dueDate: dueDate ? new Date(dueDate) : dueDate === null ? null : undefined,
      });
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        issueId: z.string().uuid(),
        body: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        body: string;
        createdAt: string;
      }>("comment.create", input);
    }),

  listComments: protectedProcedure
    .input(z.object({ issueId: z.string().uuid(), includeReplies: z.boolean().default(true) }))
    .query(async ({ input }) => {
      return kanbangerRequest<Array<{
        id: string;
        body: string;
        user?: { id: string; name: string };
        createdAt: string;
        replies?: Array<{ id: string; body: string; user?: { id: string; name: string }; createdAt: string }>;
      }>>("comment.list", input);
    }),

  searchTasks: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        query: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      return kanbangerRequest<Array<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
        project?: { id: string; name: string };
        assignee?: { id: string; name: string };
      }>>("issue.list", {
        workspaceId: input.workspaceId,
        filter: { search: input.query },
        pagination: { limit: input.limit, offset: 0, sortBy: "updatedAt", sortDirection: "desc" },
      });
    }),

  listLabels: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ input }) => {
      return kanbangerRequest<Array<{
        id: string;
        name: string;
        color: string;
        description?: string;
      }>>("label.listFlat", input);
    }),

  listCycles: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        status: z.enum(["upcoming", "active", "completed"]).optional(),
      })
    )
    .query(async ({ input }) => {
      return kanbangerRequest<Array<{
        id: string;
        name: string;
        number: number;
        status: string;
        startDate: string;
        endDate: string;
        progress: number;
        issueCount: number;
        completedCount: number;
      }>>("cycle.listByWorkspace", input);
    }),

  getCurrentUser: protectedProcedure.query(async () => {
    return kanbangerRequest<{
      id: string;
      email: string;
      name: string;
      avatarUrl?: string;
    }>("user.me");
  }),

  agentClaimTask: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        issueId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        issueId: string;
        status: string;
        claimedAt: string;
      }>("agent.claimTask", input);
    }),

  agentReportProgress: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        progress: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        status: string;
      }>("agent.reportProgress", input);
    }),

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
            })
          )
          .optional(),
        markIssueDone: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        status: string;
        completedAt: string;
      }>("agent.completeTask", {
        taskRunId: input.taskRunId,
        result: {
          success: true,
          summary: input.summary,
          artifacts: input.artifacts,
        },
        markIssueDone: input.markIssueDone,
      });
    }),

  agentFailTask: protectedProcedure
    .input(
      z.object({
        taskRunId: z.string().uuid(),
        errorCode: z.string(),
        errorMessage: z.string(),
        recoverable: z.boolean().default(false),
        returnToBacklog: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        status: string;
      }>("agent.failTask", input);
    }),

  agentGetAvailableTasks: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input }) => {
      return kanbangerRequest<Array<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        priority: string;
        project?: { id: string; name: string; key: string };
        labels?: Array<{ id: string; name: string }>;
      }>>("agent.getAvailableTasks", input);
    }),

  agentStartSession: protectedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        clientInfo: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        startedAt: string;
      }>("agent.startSession", input);
    }),

  agentEndSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return kanbangerRequest<{
        id: string;
        endedAt: string;
      }>("agent.endSession", input);
    }),
} satisfies TRPCRouterRecord;
