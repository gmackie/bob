/**
 * Effect-RPC handler functions for the event RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  eventList,
  eventCreate,
  eventRecentActivity,
  eventByWorktree,
  eventStats,
} from "../handlers/event.js";

export const makeEventRpcHandlers = (ctx: HandlerContext) => ({
  "event.list": ({
    payload,
  }: {
    payload: {
      worktreeId?: string;
      repositoryId?: string;
      eventType?: string;
      limit: number;
      offset: number;
      since?: Date;
      until?: Date;
    };
  }) => wrapHandler(eventList, ctx, payload, "event"),

  "event.create": ({
    payload,
  }: {
    payload: {
      worktreeId?: string;
      repositoryId?: string;
      eventType: string;
      payload: Record<string, unknown>;
    };
  }) => wrapHandler(eventCreate, ctx, payload, "event"),

  "event.recentActivity": ({
    payload,
  }: {
    payload: { limit: number };
  }) => wrapHandler(eventRecentActivity, ctx, payload, "event"),

  "event.byWorktree": ({
    payload,
  }: {
    payload: {
      worktreeId: string;
      limit: number;
      since?: Date;
    };
  }) => wrapHandler(eventByWorktree, ctx, payload, "event"),

  "event.stats": ({
    payload,
  }: {
    payload: {
      worktreeId?: string;
      repositoryId?: string;
      since?: Date;
    };
  }) => wrapHandler(eventStats, ctx, payload, "event"),
});
