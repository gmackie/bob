/**
 * Effect-RPC handler functions for the agentRun RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapAuthorizedHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */

import type { HandlerContext } from "../handlers/context.js";
import { wrapAuthorizedHandler } from "../handlers/authorized-rpc.js";
import {
  agentRunGet,
  agentRunList,
  agentRunListAll,
  agentRunListByWorkItem,
} from "../handlers/agentRun.js";

export const makeAgentRunRpcHandlers = (ctx: HandlerContext) => ({
  "agentRun.get": ({
    payload,
  }: {
    payload: { runId: string };
  }) => wrapAuthorizedHandler(agentRunGet, ctx, payload, "agentRun"),

  "agentRun.list": ({
    payload,
  }: {
    payload: { workspaceId: string; limit: number };
  }) => wrapAuthorizedHandler(agentRunList, ctx, payload, "agentRun"),

  "agentRun.listAll": ({
    payload,
  }: {
    payload: { limit: number };
  }) => wrapAuthorizedHandler(agentRunListAll, ctx, payload, "agentRun"),

  "agentRun.listByWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string; limit: number };
  }) => wrapAuthorizedHandler(agentRunListByWorkItem, ctx, payload, "agentRun"),
});
