import { z } from "zod/v4";
import type { OpenAPIV3_1 } from "openapi-types";

import { integrations } from "@bob/config";

import { workItemsRestOperations } from "./contracts/work-items-rest";
import { generateOpenApiFromRouter } from "./contracts/router-openapi";
import type { RouterOpenApiConfig } from "./contracts/router-openapi";

// Effect-RPC OpenAPI generation lives in a light, contracts-only module so it
// can be imported by a standalone build script. Re-exported here for callers
// that already import from "@bob/api/openapi".
export {
  BOB_RPC_GROUPS,
  generateBobRpcApiDocument,
} from "./contracts/bob-rpc-groups.js";

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
  };
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

// Effect-RPC OpenAPI generation (`generateBobRpcApiDocument`, `BOB_RPC_GROUPS`)
// is defined in ./contracts/bob-rpc-groups.ts and re-exported at the top of
// this file. It supersedes the tRPC-era `generateFullBobApiDocument` above.
// See docs/plans/2026-06-21-bob-effect-rpc-openapi.md.
