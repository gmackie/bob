import { AuthRpc } from "@gmacko/core/contracts/groups/auth";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface AuthClient extends Record<string, unknown> {
  readonly getSession: () => Promise<unknown>;
  readonly whoAmI: () => Promise<unknown>;
}

export const makeAuthClient = (runtime: ClientRuntime): AuthClient => {
  const invoke = makeInvoke(runtime, AuthRpc);

  return {
    whoAmI: () => invoke("auth.whoAmI"),
    listMemberships: () => invoke("auth.listMemberships"),
    resolveTenant: (input?: unknown) => invoke("auth.resolveTenant", input),
    issueApiKey: (input?: unknown) => invoke("auth.issueApiKey", input),
    listApiKeys: () => invoke("auth.listApiKeys"),
    revokeApiKey: (input?: unknown) => invoke("auth.revokeApiKey", input),
    startDeviceFlow: () => invoke("auth.startDeviceFlow"),
    pollDeviceCode: (input?: unknown) => invoke("auth.pollDeviceCode", input),
    approveDeviceCode: (input?: unknown) =>
      invoke("auth.approveDeviceCode", input),
    getSession: () => invoke("auth.getSession"),
    getSecretMessage: (input?: unknown) =>
      invoke("auth.getSecretMessage", input),
  };
};
