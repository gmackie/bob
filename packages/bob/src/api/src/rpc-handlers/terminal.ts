/**
 * Effect-RPC handler functions for the terminal RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  terminalCreateAgentSession,
  terminalCreateDirectorySession,
  terminalCreateSystemSession,
  terminalListByInstance,
  terminalClose,
} from "../handlers/terminal.js";

export const makeTerminalRpcHandlers = (ctx: HandlerContext) => ({
  "terminal.createAgentSession": ({
    payload,
  }: {
    payload: { instanceId: string };
  }) => wrapHandler(terminalCreateAgentSession, ctx, payload, "terminal"),

  "terminal.createDirectorySession": ({
    payload,
  }: {
    payload: { instanceId: string };
  }) => wrapHandler(terminalCreateDirectorySession, ctx, payload, "terminal"),

  "terminal.createSystemSession": ({
    payload,
  }: {
    payload: { cwd?: string; initialCommand?: string };
  }) => wrapHandler(terminalCreateSystemSession, ctx, payload, "terminal"),

  "terminal.listByInstance": ({
    payload,
  }: {
    payload: { instanceId: string };
  }) => wrapHandler(terminalListByInstance, ctx, payload, "terminal"),

  "terminal.close": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(terminalClose, ctx, payload, "terminal"),
});
