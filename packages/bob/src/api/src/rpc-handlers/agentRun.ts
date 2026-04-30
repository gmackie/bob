/**
 * Effect-RPC handler functions for the agentRun RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  agentRunGet,
  agentRunList,
  agentRunListByWorkItem,
} from "../handlers/agentRun.js";

export const makeAgentRunRpcHandlers = (ctx: HandlerContext) => ({
  "agentRun.get": ({
    payload,
  }: {
    payload: { runId: string };
  }) => wrapHandler(agentRunGet, ctx, payload, "agentRun"),

  "agentRun.list": ({
    payload,
  }: {
    payload: { workspaceId: string; limit: number };
  }) => wrapHandler(agentRunList, ctx, payload, "agentRun"),

  "agentRun.listByWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string; limit: number };
  }) => wrapHandler(agentRunListByWorkItem, ctx, payload, "agentRun"),
});
