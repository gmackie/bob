/**
 * Effect-RPC handler functions for the link RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  linkList,
  linkById,
  linkByWorktree,
  linkCreate,
  linkUpdate,
  linkDelete,
  linkToPlanningTask,
  linkToGitHubPR,
} from "../handlers/link.js";

export const makeLinkRpcHandlers = (ctx: HandlerContext) => ({
  "link.list": ({
    payload,
  }: {
    payload: {
      worktreeId?: string;
      linkType?: string;
    };
  }) => wrapHandler(linkList, ctx, payload, "link"),

  "link.byId": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(linkById, ctx, payload, "link"),

  "link.byWorktree": ({
    payload,
  }: {
    payload: { worktreeId: string };
  }) => wrapHandler(linkByWorktree, ctx, payload, "link"),

  "link.create": ({
    payload,
  }: {
    payload: {
      worktreeId: string;
      linkType: string;
      externalId?: string;
      url?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };
  }) => wrapHandler(linkCreate, ctx, payload, "link"),

  "link.update": ({
    payload,
  }: {
    payload: {
      id: string;
      externalId?: string;
      url?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };
  }) => wrapHandler(linkUpdate, ctx, payload, "link"),

  "link.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(linkDelete, ctx, payload, "link"),

  "link.linkToPlanningTask": ({
    payload,
  }: {
    payload: {
      worktreeId: string;
      taskId: string;
      taskUrl?: string;
      taskTitle?: string;
    };
  }) => wrapHandler(linkToPlanningTask, ctx, payload, "link"),

  "link.linkToGitHubPR": ({
    payload,
  }: {
    payload: {
      worktreeId: string;
      prNumber: number;
      prUrl: string;
      prTitle: string;
      repoOwner: string;
      repoName: string;
    };
  }) => wrapHandler(linkToGitHubPR, ctx, payload, "link"),
});
