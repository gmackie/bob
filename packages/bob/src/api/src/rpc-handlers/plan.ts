/**
 * Effect-RPC handler functions for the plan RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 6.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  planList,
  planById,
  planByWorktree,
  planCreate,
  planUpdate,
  planDelete,
  planSyncFromFile,
  planAddTask,
  planUpdateTask,
  planDeleteTask,
  planReorderTasks,
} from "../handlers/plan.js";

export const makePlanRpcHandlers = (ctx: HandlerContext) => ({
  "plan.list": ({
    payload,
  }: {
    payload: { worktreeId?: string };
  }) => wrapHandler(planList, ctx, payload, "plan"),

  "plan.byId": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planById, ctx, payload, "plan"),

  "plan.byWorktree": ({
    payload,
  }: {
    payload: { worktreeId: string };
  }) => wrapHandler(planByWorktree, ctx, payload, "plan"),

  "plan.create": ({
    payload,
  }: {
    payload: {
      worktreeId: string;
      title: string;
      goal?: string;
      status?: string;
      planningTaskId?: string | null;
    };
  }) => wrapHandler(planCreate, ctx, payload, "plan"),

  "plan.update": ({
    payload,
  }: {
    payload: {
      id: string;
      title?: string;
      goal?: string;
      status?: string;
      planningTaskId?: string | null;
    };
  }) => wrapHandler(planUpdate, ctx, payload, "plan"),

  "plan.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planDelete, ctx, payload, "plan"),

  "plan.syncFromFile": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planSyncFromFile, ctx, payload, "plan"),

  "plan.addTask": ({
    payload,
  }: {
    payload: {
      planId: string;
      content: string;
      status?: string;
      priority?: string;
      sortOrder?: number;
    };
  }) => wrapHandler(planAddTask, ctx, payload, "plan"),

  "plan.updateTask": ({
    payload,
  }: {
    payload: {
      id: string;
      content?: string;
      status?: string;
      priority?: string;
      sortOrder?: number;
    };
  }) => wrapHandler(planUpdateTask, ctx, payload, "plan"),

  "plan.deleteTask": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(planDeleteTask, ctx, payload, "plan"),

  "plan.reorderTasks": ({
    payload,
  }: {
    payload: { planId: string; taskIds: string[] };
  }) => wrapHandler(planReorderTasks, ctx, payload, "plan"),
});
