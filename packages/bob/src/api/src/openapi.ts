import { z } from "zod/v4";
import type { OpenAPIV3_1 } from "openapi-types";

import { integrations } from "@bob/config";

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

import { workItemsRestOperations } from "./contracts/work-items-rest";
import { generateOpenApiFromRouter } from "./contracts/router-openapi";
import type { RouterOpenApiConfig } from "./contracts/router-openapi";
import {
  generateOpenApiFromRpcGroups,
  type RpcGroupLike,
} from "./contracts/rpc-openapi";

export interface OpenApiConfig {
  title: string;
  version: string;
  description?: string;
  baseUrl: string;
}

const defaultConfig: OpenApiConfig = {
  title: "Bob API",
  version: "1.0.0",
  description: "Generated OpenAPI contract for Bob REST adapters",
  baseUrl: "http://localhost:3000",
};

function toOpenApiSchema(schema: z.ZodTypeAny): OpenAPIV3_1.SchemaObject {
  return z.toJSONSchema(schema) as OpenAPIV3_1.SchemaObject;
}

export function isOpenApiEnabled(): boolean {
  return integrations.openapi;
}

export function generateApiDocument(
  config: Partial<OpenApiConfig> = {},
): OpenAPIV3_1.Document {
  const mergedConfig = { ...defaultConfig, ...config };

  const paths = Object.fromEntries(
    workItemsRestOperations.map((operation) => [
      operation.restPath,
      {
        post: {
          tags: ["workItems"],
          summary: operation.summary,
          operationId: operation.procedurePath,
          security:
            operation.auth === "session"
              ? [{ cookieAuth: [] }]
              : [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: toOpenApiSchema(operation.inputSchema),
              },
            },
          },
          responses: {
            "200": {
              description: "Successful response",
              content: {
                "application/json": {
                  schema: toOpenApiSchema(operation.outputSchema),
                },
              },
            },
            "400": {
              description: "Invalid request payload",
            },
            "401": {
              description: "Unauthorized",
            },
            "404": {
              description: "Resource not found",
            },
          },
        },
      },
    ]),
  ) as Record<string, unknown>;

  return {
    openapi: "3.1.0",
    info: {
      title: mergedConfig.title,
      version: mergedConfig.version,
      description: mergedConfig.description,
    },
    servers: [
      {
        url: mergedConfig.baseUrl,
        description: "API Server",
      },
    ],
    paths: paths as OpenAPIV3_1.PathsObject,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
    },
    tags: [
      {
        name: "workItems",
        description: "RPC-style REST adapters for work item procedures",
      },
    ],
  } as OpenAPIV3_1.Document;
}

export function getOpenApiSpec(config?: Partial<OpenApiConfig>): string {
  if (!integrations.openapi) {
    return JSON.stringify({ error: "OpenAPI not enabled" });
  }

  return JSON.stringify(generateApiDocument(config), null, 2);
}

// ---------------------------------------------------------------------------
// Full-router OpenAPI generation (auto-introspects the tRPC router tree)
// ---------------------------------------------------------------------------

/**
 * Generate a complete OpenAPI 3.1 document covering every procedure in a
 * tRPC router. This introspects the router's `_def.record` at runtime,
 * so no manual annotation is needed.
 *
 * @param router - The tRPC `appRouter` (or any router / raw record).
 * @param config - Optional overrides for document metadata.
 */
export function generateFullBobApiDocument(
  router: Record<string, unknown>,
  config: Partial<OpenApiConfig> = {},
): OpenAPIV3_1.Document {
  const merged = { ...defaultConfig, ...config };

  return generateOpenApiFromRouter(router, {
    title: merged.title,
    version: merged.version,
    description: merged.description,
    baseUrl: merged.baseUrl,
  } satisfies RouterOpenApiConfig);
}

// ---------------------------------------------------------------------------
// Effect-RPC OpenAPI generation (source of truth: the Rpc contract groups)
// ---------------------------------------------------------------------------
//
// Supersedes the tRPC-era `generateFullBobApiDocument` above. Bob's API moved
// to Effect-RPC (`Rpc.make` + Schema, served at /api/rpc), so the OpenAPI doc
// is derived directly from the contract groups rather than a tRPC router tree.
// See docs/plans/2026-06-21-bob-effect-rpc-openapi.md.

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

/**
 * Generate the complete OpenAPI 3.1 document for Bob from the Effect-RPC
 * contract groups. Every procedure becomes a `POST /api/v1/{tag}` operation.
 */
export function generateBobRpcApiDocument(
  config: Partial<OpenApiConfig> = {},
): OpenAPIV3_1.Document {
  const merged = { ...defaultConfig, ...config };
  return generateOpenApiFromRpcGroups(BOB_RPC_GROUPS, {
    title: merged.title,
    version: merged.version,
    description: merged.description,
    baseUrl: merged.baseUrl,
  });
}
