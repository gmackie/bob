/**
 * Aggregate layer that maps handler factory outputs to SettingsRpc contract
 * names (20 procedures).
 *
 * Imports the three handler factories (settings, cookies, system),
 * instantiates them with a HandlerContext, and wires each factory key to the
 * corresponding contract procedure name expected by SettingsRpc.toLayer().
 *
 * Zero stubs — all 20 contract procedures have Bob equivalents.
 *
 * Phase 7B-4D-delta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { SettingsRpc } from "@gmacko/core/contracts/groups/settings";
import { makeSettingsRpcHandlers } from "../rpc-handlers/settings.js";
import { makeCookiesRpcHandlers } from "../rpc-handlers/cookies.js";
import { makeSystemRpcHandlers } from "../rpc-handlers/system.js";

export const makeSettingsLayer = (ctx: HandlerContext) => {
  const set = makeSettingsRpcHandlers(ctx);
  const ck = makeCookiesRpcHandlers(ctx);
  const sys = makeSystemRpcHandlers(ctx);

  return SettingsRpc.toLayer({
    // --- Settings (13) — settings.* → settings.* (direct match) ---
    "settings.getPreferences": set["settings.getPreferences"],
    "settings.updatePreferences": set["settings.updatePreferences"],
    "settings.listApiKeys": set["settings.listApiKeys"],
    "settings.createApiKey": set["settings.createApiKey"],
    "settings.revokeApiKey": set["settings.revokeApiKey"],
    "settings.listConfigRoots": set["settings.listConfigRoots"],
    "settings.listConfigEntries": set["settings.listConfigEntries"],
    "settings.readConfigFile": set["settings.readConfigFile"],
    "settings.writeConfigFile": set["settings.writeConfigFile"],
    "settings.deleteConfigFile": set["settings.deleteConfigFile"],
    "settings.getForgeGraphConnection": set["settings.getForgeGraphConnection"],
    "settings.connectForgeGraph": set["settings.connectForgeGraph"],
    "settings.disconnectForgeGraph": set["settings.disconnectForgeGraph"],

    // --- Cookies (5) — cookies.* → settings.cookies.* ---
    "settings.cookies.import": ck["cookies.import"],
    "settings.cookies.list": ck["cookies.list"],
    "settings.cookies.remove": ck["cookies.remove"],
    "settings.cookies.getForSession": ck["cookies.getForSession"],
    "settings.cookies.setSessionScopes": ck["cookies.setSessionScopes"],

    // --- System (2) — system.* → settings.system.* ---
    "settings.system.health": sys["system.health"],
    "settings.system.status": sys["system.status"],
  });
};
