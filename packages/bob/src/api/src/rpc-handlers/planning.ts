/**
 * Effect-RPC handler functions for the planning RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 9.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
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
  planningAgentClaimTask,
  planningAgentReportProgress,
  planningAgentCompleteTask,
  planningAgentFailTask,
  planningAgentGetAvailableTasks,
  planningAgentStartSession,
  planningAgentEndSession,
} from "../handlers/planning.js";
import { syncLinearProjects } from "../handlers/linearSetup.js";

export const makePlanningRpcHandlers = (ctx: HandlerContext) => ({
  "planning.listWorkspaces": ({
    payload: _payload,
  }: {
    payload: void;
  }) => wrapHandler(planningListWorkspaces, ctx, undefined as void, "workspace"),

  "planning.listProjects": ({
    payload,
  }: {
    payload: { workspaceId: string };
  }) => wrapHandler(planningListProjects, ctx, payload, "project"),

  "planning.getProject": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planningGetProject, ctx, payload, "project"),

  "planning.listTasks": ({
    payload,
  }: {
    payload: {
      workspaceId: string;
      projectId?: string;
      status?: string;
      priority?: string;
      assigneeId?: string;
      search?: string;
      limit?: number;
    };
  }) => wrapHandler(planningListTasks, ctx, payload, "task"),

  "planning.getTask": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planningGetTask, ctx, payload, "task"),

  "planning.getTaskByIdentifier": ({
    payload,
  }: {
    payload: { identifier: string; workspaceId?: string };
  }) => wrapHandler(planningGetTaskByIdentifier, ctx, payload, "task"),

  "planning.createTask": ({
    payload,
  }: {
    payload: {
      projectId: string;
      title: string;
      description?: string;
      kind?: string;
      status?: string;
      priority?: string;
      assigneeId?: string;
      labelIds?: string[];
      dueDate?: string;
    };
  }) => wrapHandler(planningCreateTask, ctx, payload, "task"),

  "planning.updateTask": ({
    payload,
  }: {
    payload: {
      id: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
    };
  }) => wrapHandler(planningUpdateTask, ctx, payload, "task"),

  "planning.addComment": ({
    payload,
  }: {
    payload: { issueId: string; body: string };
  }) => wrapHandler(planningAddComment, ctx, payload, "comment"),

  "planning.listComments": ({
    payload,
  }: {
    payload: { issueId: string; includeReplies?: boolean };
  }) => wrapHandler(planningListComments, ctx, payload, "comment"),

  "planning.searchTasks": ({
    payload,
  }: {
    payload: { workspaceId: string; query: string; limit?: number };
  }) => wrapHandler(planningSearchTasks, ctx, payload, "task"),

  "planning.listLabels": ({
    payload,
  }: {
    payload: { workspaceId: string };
  }) => wrapHandler(planningListLabels, ctx, payload, "label"),

  "planning.listCycles": ({
    payload,
  }: {
    payload: { workspaceId: string; status?: string };
  }) => wrapHandler(planningListCycles, ctx, payload, "cycle"),

  "planning.syncLinearProjects": ({
    payload,
  }: {
    payload: { workspaceId: string; importIssues?: boolean };
  }) => wrapHandler(syncLinearProjects, ctx, payload, "planning"),

  "planning.agentClaimTask": ({
    payload,
  }: {
    payload: { agentId: string; issueId: string; sessionId?: string };
  }) => wrapHandler(planningAgentClaimTask, ctx, payload, "agent"),

  "planning.agentReportProgress": ({
    payload,
  }: {
    payload: { taskRunId: string; progress: string };
  }) => wrapHandler(planningAgentReportProgress, ctx, payload, "agent"),

  "planning.agentCompleteTask": ({
    payload,
  }: {
    payload: {
      taskRunId: string;
      summary?: string;
      artifacts?: Array<{
        type: "pr" | "commit" | "file" | "comment";
        url?: string;
        description?: string;
      }>;
      markIssueDone?: boolean;
    };
  }) => wrapHandler(planningAgentCompleteTask, ctx, payload, "agent"),

  "planning.agentFailTask": ({
    payload,
  }: {
    payload: {
      taskRunId: string;
      errorCode: string;
      errorMessage: string;
      recoverable?: boolean;
      returnToBacklog?: boolean;
    };
  }) => wrapHandler(planningAgentFailTask, ctx, payload, "agent"),

  "planning.agentGetAvailableTasks": ({
    payload,
  }: {
    payload: { agentId: string; workspaceId: string; limit?: number };
  }) => wrapHandler(planningAgentGetAvailableTasks, ctx, payload, "agent"),

  "planning.agentStartSession": ({
    payload,
  }: {
    payload: { agentId: string; workspaceId: string; clientInfo?: string };
  }) => wrapHandler(planningAgentStartSession, ctx, payload, "agent"),

  "planning.agentEndSession": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(planningAgentEndSession, ctx, payload, "agent"),
});
