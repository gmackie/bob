import type { OpenAPIV3_1 } from "openapi-types";
import { z } from "zod/v4";

import { integrations } from "@bob/config";

import { workItemsRestOperations } from "./contracts/work-items-rest";

export interface OpenApiConfig {
  title: string;
  version: string;
  description?: string;
  baseUrl: string;
}

const defaultConfig: OpenApiConfig = {
  title: "BizPulse API",
  version: "1.0.0",
  description: "Generated OpenAPI contract for BizPulse REST adapters",
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
