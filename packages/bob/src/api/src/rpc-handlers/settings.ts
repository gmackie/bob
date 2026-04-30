/**
 * Effect-RPC handler functions for the settings RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 7.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  settingsGetPreferences,
  settingsUpdatePreferences,
  settingsListApiKeys,
  settingsCreateApiKey,
  settingsRevokeApiKey,
  settingsListConfigRoots,
  settingsListConfigEntries,
  settingsReadConfigFile,
  settingsWriteConfigFile,
  settingsDeleteConfigFile,
  settingsGetForgeGraphConnection,
  settingsConnectForgeGraph,
  settingsDisconnectForgeGraph,
} from "../handlers/settings.js";

export const makeSettingsRpcHandlers = (ctx: HandlerContext) => ({
  "settings.getPreferences": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler(settingsGetPreferences, ctx, payload as any, "settings"),

  "settings.updatePreferences": ({
    payload,
  }: {
    payload: Record<string, unknown>;
  }) => wrapHandler(settingsUpdatePreferences, ctx, payload, "settings"),

  "settings.listApiKeys": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler(settingsListApiKeys, ctx, payload as any, "settings"),

  "settings.createApiKey": ({
    payload,
  }: {
    payload: {
      name: string;
      permissions: Array<"read" | "write" | "delete" | "admin">;
      expiresInDays?: number;
    };
  }) => wrapHandler(settingsCreateApiKey, ctx, payload, "settings"),

  "settings.revokeApiKey": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(settingsRevokeApiKey, ctx, payload, "settings"),

  "settings.listConfigRoots": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler(settingsListConfigRoots as any, ctx, payload as any, "settings"),

  "settings.listConfigEntries": ({
    payload,
  }: {
    payload: { rootId: string; dir?: string };
  }) => wrapHandler(settingsListConfigEntries, ctx, payload as any, "settings"),

  "settings.readConfigFile": ({
    payload,
  }: {
    payload: { rootId: string; path: string };
  }) => wrapHandler(settingsReadConfigFile, ctx, payload as any, "settings"),

  "settings.writeConfigFile": ({
    payload,
  }: {
    payload: { rootId: string; path: string; content: string; createOnly?: boolean };
  }) => wrapHandler(settingsWriteConfigFile, ctx, payload as any, "settings"),

  "settings.deleteConfigFile": ({
    payload,
  }: {
    payload: { rootId: string; path: string };
  }) => wrapHandler(settingsDeleteConfigFile, ctx, payload as any, "settings"),

  "settings.getForgeGraphConnection": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler(settingsGetForgeGraphConnection, ctx, payload as any, "settings"),

  "settings.connectForgeGraph": ({
    payload,
  }: {
    payload: { apiToken: string };
  }) => wrapHandler(settingsConnectForgeGraph, ctx, payload, "settings"),

  "settings.disconnectForgeGraph": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler(settingsDisconnectForgeGraph, ctx, payload as any, "settings"),
});
