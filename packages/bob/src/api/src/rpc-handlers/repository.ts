/**
 * Effect-RPC handler functions for the repository RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 7.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  repositoryList,
  repositoryById,
  repositoryAdd,
  repositoryAddFromProvider,
  repositoryDelete,
  repositoryRefreshMainBranch,
  repositoryGetWorktrees,
  repositoryCreateWorktree,
  repositoryGetWorktreePlanning,
  repositoryUpdateWorktreePlanning,
  repositoryDeleteWorktree,
  repositoryGetWorktreeMergeStatus,
} from "../handlers/repository.js";

export const makeRepositoryRpcHandlers = (ctx: HandlerContext) => ({
  "repository.list": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) =>
    wrapHandler(
      (c: HandlerContext, _input: Record<string, never>) => repositoryList(c),
      ctx,
      payload,
      "repository",
    ),

  "repository.byId": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(repositoryById, ctx, payload, "repository"),

  "repository.add": ({
    payload,
  }: {
    payload: { repositoryPath: string };
  }) => wrapHandler(repositoryAdd, ctx, payload, "repository"),

  "repository.addFromProvider": ({
    payload,
  }: {
    payload: {
      fullName: string;
      cloneUrl: string;
      htmlUrl: string;
      defaultBranch: string;
      provider?: string;
      instanceUrl?: string;
      projectId?: string;
    };
  }) => wrapHandler(repositoryAddFromProvider, ctx, payload, "repository"),

  "repository.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(repositoryDelete, ctx, payload, "repository"),

  "repository.refreshMainBranch": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(repositoryRefreshMainBranch, ctx, payload, "repository"),

  "repository.getWorktrees": ({
    payload,
  }: {
    payload: { repositoryId: string };
  }) => wrapHandler(repositoryGetWorktrees, ctx, payload, "repository"),

  "repository.createWorktree": ({
    payload,
  }: {
    payload: {
      repositoryId: string;
      branchName: string;
      baseBranch?: string;
      agentType: string;
      planning?: {
        title?: string;
        goal?: string;
        planningTaskId?: string;
        tasks?: {
          key: string;
          content: string;
          status?: "pending" | "in_progress" | "completed" | "cancelled";
        }[];
      };
    };
  }) => wrapHandler(repositoryCreateWorktree, ctx, payload, "repository"),

  "repository.getWorktreePlanning": ({
    payload,
  }: {
    payload: { worktreeId: string };
  }) => wrapHandler(repositoryGetWorktreePlanning, ctx, payload, "repository"),

  "repository.updateWorktreePlanning": ({
    payload,
  }: {
    payload: {
      worktreeId: string;
      content?: string;
      title?: string;
      goal?: string;
      status?: string;
      planningTaskId?: string | null;
      tasks?: {
        key: string;
        content: string;
        status?: "pending" | "in_progress" | "completed" | "cancelled";
      }[];
    };
  }) => wrapHandler(repositoryUpdateWorktreePlanning, ctx, payload, "repository"),

  "repository.deleteWorktree": ({
    payload,
  }: {
    payload: { worktreeId: string; force?: boolean };
  }) => wrapHandler(repositoryDeleteWorktree, ctx, payload, "repository"),

  "repository.getWorktreeMergeStatus": ({
    payload,
  }: {
    payload: { worktreeId: string };
  }) => wrapHandler(repositoryGetWorktreeMergeStatus, ctx, payload, "repository"),
});
