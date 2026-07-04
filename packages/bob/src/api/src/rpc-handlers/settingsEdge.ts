/**
 * Effect-RPC handler functions for the settingsEdge RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  settingsEdgeGetPreferences,
  settingsEdgeUpdatePreferences,
  settingsEdgeListApiKeys,
  settingsEdgeCreateApiKey,
  settingsEdgeRevokeApiKey,
  settingsEdgeGetForgeGraphConnection,
  settingsEdgeConnectForgeGraph,
  settingsEdgeDisconnectForgeGraph,
} from "../handlers/settingsEdge.js";

export const makeSettingsEdgeRpcHandlers = (ctx: HandlerContext) => ({
  "settingsEdge.getPreferences": ({
    payload,
  }: {
    payload: void;
  }) => wrapHandler(settingsEdgeGetPreferences, ctx, payload, "settingsEdge"),

  "settingsEdge.updatePreferences": ({
    payload,
  }: {
    payload: Record<string, unknown>;
  }) => wrapHandler(settingsEdgeUpdatePreferences, ctx, payload, "settingsEdge"),

  "settingsEdge.listApiKeys": ({
    payload,
  }: {
    payload: void;
  }) => wrapHandler(settingsEdgeListApiKeys, ctx, payload, "settingsEdge"),

  "settingsEdge.createApiKey": ({
    payload,
  }: {
    payload: {
      name: string;
      permissions: ("read" | "write" | "delete" | "admin")[];
      expiresInDays?: number;
    };
  }) => wrapHandler(settingsEdgeCreateApiKey, ctx, payload, "settingsEdge"),

  "settingsEdge.revokeApiKey": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(settingsEdgeRevokeApiKey, ctx, payload, "settingsEdge"),

  "settingsEdge.getForgeGraphConnection": ({
    payload,
  }: {
    payload: void;
  }) => wrapHandler(settingsEdgeGetForgeGraphConnection, ctx, payload, "settingsEdge"),

  "settingsEdge.connectForgeGraph": ({
    payload,
  }: {
    payload: { apiToken: string };
  }) => wrapHandler(settingsEdgeConnectForgeGraph, ctx, payload, "settingsEdge"),

  "settingsEdge.disconnectForgeGraph": ({
    payload,
  }: {
    payload: void;
  }) => wrapHandler(settingsEdgeDisconnectForgeGraph, ctx, payload, "settingsEdge"),
});
