/**
 * Effect-RPC handler functions for the agentRun RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { Effect } from "effect";
import { RpcError } from "@gmacko/core/rpc/errors";

import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  agentRunGet,
  agentRunList,
  agentRunListAll,
  agentRunListByWorkItem,
} from "../handlers/agentRun.js";

/**
 * Map any handler-level failure to the core `RpcError` declared on the
 * `agent.run.list` / `agent.run.listAll` contracts. `wrapHandler` fails with
 * Bob-tagged errors (`BobConflictError`, `BobNotFoundError`, ...) whose tags
 * the shared core contract cannot declare (core mustn't depend on Bob) — so
 * without this remap the client hits an undecodable SchemaError and the panel
 * silently renders empty. The underlying message is preserved (for a raw throw,
 * `BobConflictError.message` is already `INTERNAL_SERVER_ERROR: <real error>`),
 * so the real cause reaches the client and is displayable.
 */
const toRpcError = (e: unknown): RpcError => {
  if (e instanceof RpcError) return e;
  const anyE = e as {
    _tag?: string;
    message?: string;
    entity?: string;
    id?: string;
  } | null;
  const message =
    anyE?.message ??
    (anyE?.entity
      ? `${anyE.entity} ${anyE.id ?? ""}`.trim() + " not found"
      : undefined) ??
    (anyE?._tag ? String(anyE._tag) : String(e));
  return new RpcError({ message, cause: e });
};

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
  }) => Effect.mapError(wrapHandler(agentRunList, ctx, payload, "agentRun"), toRpcError),

  "agentRun.listAll": ({
    payload,
  }: {
    payload: { limit: number };
  }) => Effect.mapError(wrapHandler(agentRunListAll, ctx, payload, "agentRun"), toRpcError),

  "agentRun.listByWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string; limit: number };
  }) => wrapHandler(agentRunListByWorkItem, ctx, payload, "agentRun"),
});
