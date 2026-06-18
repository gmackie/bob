/**
 * Effect-RPC handler functions for the requirement RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  requirementList,
  requirementCreate,
  requirementUpdate,
  requirementDelete,
  requirementLinkToTask,
} from "../handlers/requirement.js";

export const makeRequirementRpcHandlers = (ctx: HandlerContext) => ({
  "requirement.list": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(requirementList, ctx, payload, "requirement"),

  "requirement.create": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      category: "data" | "api" | "ui" | "infra" | "test" | "other";
      description: string;
      sortOrder?: number;
    };
  }) => wrapHandler(requirementCreate, ctx, payload, "requirement"),

  "requirement.update": ({
    payload,
  }: {
    payload: {
      id: string;
      description?: string;
      status?: "pending" | "in_progress" | "done";
      category?: "data" | "api" | "ui" | "infra" | "test" | "other";
      sortOrder?: number;
    };
  }) => wrapHandler(requirementUpdate, ctx, payload, "requirement"),

  "requirement.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(requirementDelete, ctx, payload, "requirement"),

  "requirement.linkToTask": ({
    payload,
  }: {
    payload: { id: string; taskId: string };
  }) => wrapHandler(requirementLinkToTask, ctx, payload, "requirement"),
});
