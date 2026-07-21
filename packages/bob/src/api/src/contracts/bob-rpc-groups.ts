/**
 * Assembles Bob's Effect-RPC contract groups and generates the OpenAPI 3.1
 * document from them. Kept deliberately light: it imports ONLY the contract
 * groups (Schema + Rpc definitions) and the pure generator — NOT @bob/auth,
 * @bob/db, @bob/config, or the Zod REST adapters. This lets a standalone build
 * script (scripts/generate-openapi.ts) import it without dragging in runtime
 * deps that need env vars or native modules.
 */
import {
  WorkItemsRpc,
  PlanningRpc,
  ExternalRpc,
} from "@gmacko/bob/contracts";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import { SettingsRpc } from "@gmacko/core/contracts/groups/settings";
import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";
import type { OpenAPIV3_1 } from "openapi-types";

import { generateOpenApiFromRpcGroups } from "./rpc-openapi.js";
import type { RpcGroupLike, RpcOpenApiConfig } from "./rpc-openapi.js";

/**
 * The 8 exported Effect-RPC contract groups served by Bob, in the same order
 * the server merges them (`apps/bob/src/server/rpc.ts`). The server-internal
 * `HealthRpc` probe is intentionally omitted — it is not a public REST surface.
 */
export const BOB_RPC_GROUPS = [
  WorkItemsRpc,
  PlanningRpc,
  ExternalRpc,
  AgentRpc,
  ProjectsRpc,
  SettingsRpc,
  SecretsRpc,
  AuthRpc,
] as unknown as readonly RpcGroupLike[];

const DEFAULTS: RpcOpenApiConfig = {
  title: "Bob API",
  version: "1.0.0",
  description: "OpenAPI 3.1 contract generated from Bob's Effect-RPC groups",
  baseUrl: "https://bob.blder.bot",
};

/**
 * Generate the complete OpenAPI 3.1 document for Bob from the Effect-RPC
 * contract groups. Every procedure becomes a `POST /api/v1/{tag}` operation.
 */
export function generateBobRpcApiDocument(
  config: Partial<RpcOpenApiConfig> = {},
): OpenAPIV3_1.Document {
  return generateOpenApiFromRpcGroups(BOB_RPC_GROUPS, { ...DEFAULTS, ...config });
}
