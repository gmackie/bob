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
import type { ConfigRootId } from "../handlers/settings.js";
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

const CONFIG_ROOT_ID_VALUES = [
  "opencode_xdg",
  "opencode_dot",
  "claude_dot",
  "codex_dot",
  "gemini_dot",
  "kiro_dot",
  "cursor_agent_dot",
] as const satisfies readonly ConfigRootId[];

/**
 * The RPC wire payload types rootId as a bare `string` (it's untrusted
 * input), but the settings handlers require the real ConfigRootId literal
 * union. Validates rather than casting, since an unrecognized rootId is a
 * genuine bad-request case, not something to silently pass through.
 */
function toConfigRootId(rootId: string): ConfigRootId {
  if ((CONFIG_ROOT_ID_VALUES as readonly string[]).includes(rootId)) {
    return rootId as ConfigRootId;
  }
  throw new Error(`Unknown config rootId: ${rootId}`);
}

export const makeSettingsRpcHandlers = (ctx: HandlerContext) => ({
  "settings.getPreferences": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler((c: HandlerContext) => settingsGetPreferences(c), ctx, payload, "settings"),

  "settings.updatePreferences": ({
    payload,
  }: {
    payload: Record<string, unknown>;
  }) => wrapHandler(settingsUpdatePreferences, ctx, payload, "settings"),

  "settings.listApiKeys": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler((c: HandlerContext) => settingsListApiKeys(c), ctx, payload, "settings"),

  "settings.createApiKey": ({
    payload,
  }: {
    payload: {
      name: string;
      permissions: ("read" | "write" | "delete" | "admin")[];
      expiresInDays?: number;
    };
  }) => wrapHandler(settingsCreateApiKey, ctx, payload, "settings"),

  "settings.revokeApiKey": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(settingsRevokeApiKey, ctx, payload, "settings"),

  "settings.listConfigRoots": (_args: {
    payload: Record<string, never>;
  }) => wrapHandler(() => settingsListConfigRoots(), ctx, undefined, "settings"),

  "settings.listConfigEntries": ({
    payload,
  }: {
    payload: { rootId: string; dir?: string };
  }) =>
    wrapHandler(
      settingsListConfigEntries,
      ctx,
      { rootId: toConfigRootId(payload.rootId), dir: payload.dir },
      "settings",
    ),

  "settings.readConfigFile": ({
    payload,
  }: {
    payload: { rootId: string; path: string };
  }) =>
    wrapHandler(
      settingsReadConfigFile,
      ctx,
      { rootId: toConfigRootId(payload.rootId), path: payload.path },
      "settings",
    ),

  "settings.writeConfigFile": ({
    payload,
  }: {
    payload: { rootId: string; path: string; content: string; createOnly?: boolean };
  }) =>
    wrapHandler(
      settingsWriteConfigFile,
      ctx,
      {
        rootId: toConfigRootId(payload.rootId),
        path: payload.path,
        content: payload.content,
        createOnly: payload.createOnly,
      },
      "settings",
    ),

  "settings.deleteConfigFile": ({
    payload,
  }: {
    payload: { rootId: string; path: string };
  }) =>
    wrapHandler(
      settingsDeleteConfigFile,
      ctx,
      { rootId: toConfigRootId(payload.rootId), path: payload.path },
      "settings",
    ),

  "settings.getForgeGraphConnection": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler((c: HandlerContext) => settingsGetForgeGraphConnection(c), ctx, payload, "settings"),

  "settings.connectForgeGraph": ({
    payload,
  }: {
    payload: { apiToken: string };
  }) => wrapHandler(settingsConnectForgeGraph, ctx, payload, "settings"),

  "settings.disconnectForgeGraph": ({
    payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler((c: HandlerContext) => settingsDisconnectForgeGraph(c), ctx, payload, "settings"),
});
