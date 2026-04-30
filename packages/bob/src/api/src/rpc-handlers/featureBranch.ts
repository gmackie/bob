/**
 * Effect-RPC handler functions for the featureBranch RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 4.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  featureBranchCreate,
  featureBranchGet,
  featureBranchList,
  featureBranchAddTaskPR,
  featureBranchMarkTaskPRMerged,
  featureBranchCreateFeaturePR,
  featureBranchUpdateStatus,
} from "../handlers/featureBranch.js";

export const makeFeatureBranchRpcHandlers = (ctx: HandlerContext) => ({
  "featureBranch.create": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      repositoryId: string;
      branchName: string;
      baseBranch?: string;
    };
  }) => wrapHandler(featureBranchCreate, ctx, payload, "featureBranch"),

  "featureBranch.get": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(featureBranchGet, ctx, payload, "featureBranch"),

  "featureBranch.list": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(featureBranchList, ctx, payload, "featureBranch"),

  "featureBranch.addTaskPR": ({
    payload,
  }: {
    payload: { featureBranchId: string; pullRequestId: string };
  }) => wrapHandler(featureBranchAddTaskPR, ctx, payload, "featureBranch"),

  "featureBranch.markTaskPRMerged": ({
    payload,
  }: {
    payload: { featureBranchId: string; pullRequestId: string };
  }) => wrapHandler(featureBranchMarkTaskPRMerged, ctx, payload, "featureBranch"),

  "featureBranch.createFeaturePR": ({
    payload,
  }: {
    payload: { featureBranchId: string; title: string; repositoryId: string };
  }) => wrapHandler(featureBranchCreateFeaturePR, ctx, payload, "featureBranch"),

  "featureBranch.updateStatus": ({
    payload,
  }: {
    payload: {
      id: string;
      status: "active" | "ready" | "merged" | "abandoned";
    };
  }) => wrapHandler(featureBranchUpdateStatus, ctx, payload, "featureBranch"),
});
