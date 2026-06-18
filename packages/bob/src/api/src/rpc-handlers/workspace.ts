/**
 * Effect-RPC handler functions for the workspace RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  workspaceList,
  workspaceCreate,
  workspaceRename,
  workspaceDelete,
} from "../handlers/workspace.js";

export const makeWorkspaceRpcHandlers = (ctx: HandlerContext) => ({
  "workspace.list": ({ payload }: { payload: void }) =>
    wrapHandler(workspaceList, ctx, payload as any, "workspace"),

  "workspace.create": ({
    payload,
  }: {
    payload: { name: string; slug: string; description?: string };
  }) => wrapHandler(workspaceCreate, ctx, payload, "workspace"),

  "workspace.rename": ({
    payload,
  }: {
    payload: { id: string; name: string };
  }) => wrapHandler(workspaceRename, ctx, payload, "workspace"),

  "workspace.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(workspaceDelete, ctx, payload, "workspace"),
});
