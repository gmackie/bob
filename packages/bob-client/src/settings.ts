import { SettingsRpc } from "@gmacko/core/contracts/groups/settings";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface SettingsClient extends Record<string, unknown> {
  readonly getPreferences: () => Promise<unknown>;
  readonly updatePreferences: RpcMethod;
  readonly listApiKeys: () => Promise<unknown>;
  readonly createApiKey: RpcMethod;
  readonly revokeApiKey: RpcMethod;
  readonly getForgeGraphConnection: () => Promise<unknown>;
  readonly connectForgeGraph: RpcMethod;
  readonly disconnectForgeGraph: () => Promise<unknown>;
  readonly cookies: {
    readonly import: RpcMethod;
    readonly list: RpcMethod;
    readonly remove: RpcMethod;
    readonly getForSession: RpcMethod;
    readonly setSessionScopes: RpcMethod;
  };
  readonly system: {
    readonly health: RpcMethod;
    readonly status: RpcMethod;
  };
}

export const makeSettingsClient = (runtime: ClientRuntime): SettingsClient => {
  const invoke = makeInvoke(runtime, SettingsRpc);

  return {
    getPreferences: () => invoke("settings.getPreferences"),
    updatePreferences: (input) => invoke("settings.updatePreferences", input),
    listApiKeys: () => invoke("settings.listApiKeys"),
    createApiKey: (input?: unknown) => invoke("settings.createApiKey", input),
    revokeApiKey: (input?: unknown) => invoke("settings.revokeApiKey", input),
    getForgeGraphConnection: () =>
      invoke("settings.getForgeGraphConnection"),
    connectForgeGraph: (input?: unknown) =>
      invoke("settings.connectForgeGraph", input),
    disconnectForgeGraph: () =>
      invoke("settings.disconnectForgeGraph"),
    cookies: {
      import: (input) => invoke("settings.cookies.import", input),
      list: (input) => invoke("settings.cookies.list", input),
      remove: (input) => invoke("settings.cookies.remove", input),
      getForSession: (input) =>
        invoke("settings.cookies.getForSession", input),
      setSessionScopes: (input) =>
        invoke("settings.cookies.setSessionScopes", input),
    },
    system: {
      health: (input) => invoke("settings.system.health", input),
      status: (input) => invoke("settings.system.status", input),
    },
  };
};
