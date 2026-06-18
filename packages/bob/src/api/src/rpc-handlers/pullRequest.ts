/**
 * Effect-RPC handler functions for the pullRequest RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 7.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  pullRequestList,
  pullRequestGet,
  pullRequestListByRepository,
  pullRequestListBySession,
  pullRequestCreate,
  pullRequestUpdate,
  pullRequestMerge,
  pullRequestSyncCommits,
  pullRequestLinkToPlanningTask,
  pullRequestRefresh,
  pullRequestListReviews,
  pullRequestAddReview,
} from "../handlers/pullRequest.js";

export const makePullRequestRpcHandlers = (ctx: HandlerContext) => ({
  "pullRequest.list": ({
    payload,
  }: {
    payload: {
      status?: "draft" | "open" | "merged" | "closed";
      limit?: number;
    };
  }) => wrapHandler(pullRequestList, ctx, payload, "pullRequest"),

  "pullRequest.get": ({
    payload,
  }: {
    payload: { pullRequestId: string };
  }) => wrapHandler(pullRequestGet, ctx, payload, "pullRequest"),

  "pullRequest.listByRepository": ({
    payload,
  }: {
    payload: {
      repositoryId: string;
      status?: "draft" | "open" | "merged" | "closed";
      limit?: number;
      includeCommits?: boolean;
    };
  }) => wrapHandler(pullRequestListByRepository, ctx, payload, "pullRequest"),

  "pullRequest.listBySession": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(pullRequestListBySession, ctx, payload, "pullRequest"),

  "pullRequest.create": ({
    payload,
  }: {
    payload: {
      repositoryId: string;
      sessionId?: string;
      title: string;
      body?: string;
      headBranch: string;
      baseBranch?: string;
      draft?: boolean;
      planningTaskId?: string;
    };
  }) => wrapHandler(pullRequestCreate, ctx, payload, "pullRequest"),

  "pullRequest.update": ({
    payload,
  }: {
    payload: {
      pullRequestId: string;
      title?: string;
      body?: string;
      state?: "open" | "closed";
    };
  }) => wrapHandler(pullRequestUpdate, ctx, payload, "pullRequest"),

  "pullRequest.merge": ({
    payload,
  }: {
    payload: {
      pullRequestId: string;
      mergeMethod?: "merge" | "squash" | "rebase";
    };
  }) => wrapHandler(pullRequestMerge, ctx, payload, "pullRequest"),

  "pullRequest.syncCommits": ({
    payload,
  }: {
    payload: { pullRequestId: string };
  }) => wrapHandler(pullRequestSyncCommits, ctx, payload, "pullRequest"),

  "pullRequest.linkToPlanningTask": ({
    payload,
  }: {
    payload: { pullRequestId: string; planningTaskId: string };
  }) => wrapHandler(pullRequestLinkToPlanningTask, ctx, payload, "pullRequest"),

  "pullRequest.refresh": ({
    payload,
  }: {
    payload: { pullRequestId: string };
  }) => wrapHandler(pullRequestRefresh, ctx, payload, "pullRequest"),

  "pullRequest.listReviews": ({
    payload,
  }: {
    payload: { pullRequestId: string };
  }) => wrapHandler(pullRequestListReviews, ctx, payload, "pullRequest"),

  "pullRequest.addReview": ({
    payload,
  }: {
    payload: {
      pullRequestId: string;
      status: "approved" | "changes_requested" | "commented";
      body?: string;
    };
  }) => wrapHandler(pullRequestAddReview, ctx, payload, "pullRequest"),
});
