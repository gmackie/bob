import "server-only";

import { AuthRpc } from "@gmacko/contracts/groups/auth";
import { ProjectsRpc } from "@gmacko/contracts/groups/projects";
import { SecretsRpc } from "@gmacko/contracts/groups/secrets";
import { AgentRpc } from "@gmacko/contracts/groups/agent";
import { AuthMiddleware } from "@gmacko/core/auth";

import { authHandlerMap } from "./auth.js";
import { projectsHandlerMap } from "./projects.js";
import { secretsHandlerMap } from "./secrets.js";
import { agentHandlerMap } from "./agent.js";

// Merge all 4 RpcGroups behind a single mount path. `RpcGroup.merge` widens
// the resulting group's Rpc-tag union; `.middleware(AuthMiddleware)` wires
// the auth middleware to every procedure so handlers receive a populated
// `CurrentUser` and `UnauthorizedError | TenantNotSelectedError` are
// routed through the RPC error channel.
//
// Single `.toLayer({...combined})` call: builds one handler layer over
// the merged group whose residual requirement-set is calculated from the
// fully-middleware-aware Rpc descriptors. Splitting into per-group
// `.toLayer({...})` and merging via `Layer.mergeAll` widens TS inference
// in a way that re-surfaces `CurrentUser` as a residual — empirically
// confirmed during 6K Task 7. Single combined `.toLayer` produces a
// clean handler-layer.
export const GmackoServerGroup = AuthRpc.merge(
  ProjectsRpc,
  SecretsRpc,
  AgentRpc,
).middleware(AuthMiddleware);

export const allHandlers = GmackoServerGroup.toLayer({
  ...authHandlerMap,
  ...projectsHandlerMap,
  ...secretsHandlerMap,
  ...agentHandlerMap,
});
