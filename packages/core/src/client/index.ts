// @gmacko/client — typed client SDK for the gmacko RPC surface.
//
// Consumers (OODA today, apps/web tomorrow) get Promise / AsyncIterable
// shaped methods against AuthRpc / ProjectsRpc / SecretsRpc / AgentRpc
// without needing to wire up an Effect runtime in the browser.
//
// Surface:
//   - `createGmackoRpcClient({ baseURL, fetch?, headers? })` — the main
//     entry point; returns `{ auth, projects, secrets, agent }`.
//   - `makeAuthClient` / `makeProjectsClient` / ... — per-group factories
//     for consumers that only need one group and want to manage the
//     runtime themselves.
//   - `__gmackoClientPhase` — sentinel for internal build checks.
import {
  makeAgentClient,
  type AgentClient,
} from "./agent.js";
import {
  makeAuthClient,
  type AuthClient,
} from "./auth.js";
import {
  makeProjectsClient,
  type ProjectsClient,
} from "./projects.js";
import {
  makeSecretsClient,
  type SecretsClient,
} from "./secrets.js";
import {
  makeRuntime,
  type ClientRuntime,
  type ClientRuntimeOptions,
} from "./internal/runtime.js";

export {
  makeAuthClient,
  makeProjectsClient,
  makeSecretsClient,
  makeAgentClient,
};
export type {
  AgentClient,
  AuthClient,
  ClientRuntime,
  ProjectsClient,
  SecretsClient,
};

/** Options accepted by {@link createGmackoRpcClient}. */
export interface GmackoClientOptions extends ClientRuntimeOptions {}

/** The assembled client — one facade per RpcGroup. */
export interface GmackoRpcClient {
  readonly auth: AuthClient;
  readonly projects: ProjectsClient;
  readonly secrets: SecretsClient;
  readonly agent: AgentClient;
}

/**
 * Build a fully-assembled gmacko RPC client pointed at `baseURL`. All four
 * RpcGroups share the same transport layer (HTTP via `fetch`).
 *
 * @example
 * ```ts
 * const client = createGmackoRpcClient({
 *   baseURL: "https://api.gmacko.example/rpc",
 *   headers: { authorization: `Bearer ${token}` },
 * });
 * const me = await client.auth.whoAmI();
 * for await (const event of client.agent.sendTurn({ conversationId, prompt })) {
 *   console.log(event);
 * }
 * ```
 */
export const createGmackoRpcClient = (
  opts: GmackoClientOptions,
): GmackoRpcClient => {
  const runtime = makeRuntime(opts);
  return {
    auth: makeAuthClient(runtime),
    projects: makeProjectsClient(runtime),
    secrets: makeSecretsClient(runtime),
    agent: makeAgentClient(runtime),
  };
};

/** Sentinel for internal build/sanity checks. Value pinned to the phase. */
export const __gmackoClientPhase = "6f" as const;
