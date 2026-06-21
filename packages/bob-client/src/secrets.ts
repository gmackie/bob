import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface SecretsClient extends Record<string, unknown> {
  readonly listSessionSecrets: RpcMethod;
  readonly session: Record<string, RpcMethod>;
}

export const makeSecretsClient = (runtime: ClientRuntime): SecretsClient => {
  const invoke = makeInvoke(runtime, SecretsRpc);

  return {
    create: (input?: unknown) => invoke("secrets.create", input),
    list: (input?: unknown) => invoke("secrets.list", input),
    getEnvelope: (input?: unknown) => invoke("secrets.getEnvelope", input),
    decryptForUse: (input?: unknown) =>
      invoke("secrets.decryptForUse", input),
    markUsed: (input?: unknown) => invoke("secrets.markUsed", input),
    delete: (input?: unknown) => invoke("secrets.delete", input),
    listSessionSecrets: (input?: unknown) =>
      invoke("secrets.session.list", input),
    session: {
      getManifest: (input) =>
        invoke("secrets.session.getManifest", input),
      getForExecution: (input) =>
        invoke("secrets.session.getForExecution", input),
      create: (input) => invoke("secrets.session.create", input),
      list: (input) => invoke("secrets.session.list", input),
      delete: (input) => invoke("secrets.session.delete", input),
      markUsed: (input) => invoke("secrets.session.markUsed", input),
      upsertDeployBinding: (input) =>
        invoke("secrets.session.upsertDeployBinding", input),
      promote: (input) => invoke("secrets.session.promote", input),
    },
  };
};
