/**
 * Effect-RPC handler functions for the instance RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 6.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  instanceList,
  instanceById,
  instanceByRepository,
  instanceByWorktree,
  instanceStart,
  instanceStop,
  instanceRestart,
  instanceDelete,
  instanceUpdateStatus,
} from "../handlers/instance.js";

type AgentType =
  | "claude"
  | "opencode"
  | "kiro"
  | "codex"
  | "gemini"
  | "smol-agent"
  | "cursor-agent"
  | "elevenlabs";

type InstanceStatus = "starting" | "running" | "stopped" | "error";

export const makeInstanceRpcHandlers = (ctx: HandlerContext) => ({
  "instance.list": () => wrapHandler(instanceList, ctx, undefined as never, "instance"),

  "instance.byId": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(instanceById, ctx, payload, "instance"),

  "instance.byRepository": ({
    payload,
  }: {
    payload: { repositoryId: string };
  }) => wrapHandler(instanceByRepository, ctx, payload, "instance"),

  "instance.byWorktree": ({
    payload,
  }: {
    payload: { worktreeId: string };
  }) => wrapHandler(instanceByWorktree, ctx, payload, "instance"),

  "instance.start": ({
    payload,
  }: {
    payload: { worktreeId: string; agentType: AgentType };
  }) => wrapHandler(instanceStart, ctx, payload, "instance"),

  "instance.stop": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(instanceStop, ctx, payload, "instance"),

  "instance.restart": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(instanceRestart, ctx, payload, "instance"),

  "instance.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(instanceDelete, ctx, payload, "instance"),

  "instance.updateStatus": ({
    payload,
  }: {
    payload: {
      id: string;
      status: InstanceStatus;
      pid?: number;
      errorMessage?: string;
    };
  }) => wrapHandler(instanceUpdateStatus, ctx, payload, "instance"),
});
