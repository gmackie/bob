/**
 * Generate an OpenAPI 3.1 document from Effect-RPC contract groups.
 *
 * The Effect-RPC contracts (`RpcGroup.make(Rpc.make(...))`) are the single
 * source of truth. Each `Rpc` carries `payloadSchema` / `successSchema` /
 * `errorSchema` (Effect `Schema`). We walk `group.requests`, convert each
 * schema to a JSON Schema node via `Schema.toJsonSchemaDocument`, and embed it
 * directly — OpenAPI 3.1 schemas ARE JSON Schema 2020-12.
 *
 * Replaces the tRPC-era `router-openapi.ts` (which walked the tRPC router tree
 * with Zod). See docs/plans/2026-06-21-bob-effect-rpc-openapi.md.
 *
 * v1 scope: uniform POST `/api/v1/{tag-as-kebab-path}` with the payload as the
 * JSON body. `$defs` are left inline on each operation; shared
 * `components.schemas` extraction is deferred.
 */
import type { OpenAPIV3_1 } from "openapi-types";
import { Schema } from "effect";

/** Structural view of an `Rpc` — avoids depending on effect's internal types. */
export interface RpcLike {
  readonly key: string;
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
}

/** Structural view of an `RpcGroup`. */
export interface RpcGroupLike {
  readonly requests: ReadonlyMap<string, RpcLike>;
}

export interface RpcOpenApiConfig {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  readonly baseUrl: string;
}

const camelToKebab = (segment: string): string =>
  segment.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Convert a dotted RPC tag to a REST path.
 * `"workItem.link.list"` → `"/api/v1/work-item/link/list"`.
 */
export const tagToRestPath = (tag: string): string =>
  `/api/v1/${tag.split(".").map(camelToKebab).join("/")}`;

/**
 * A JSON Schema node, kept loose. OpenAPI 3.1 schema objects are JSON Schema
 * 2020-12, which openapi-types models as several discriminated unions that
 * don't admit `$ref`/`$defs` on every branch. We build nodes as plain records
 * and cast once at the document boundary.
 */
type JsonNode = Record<string, unknown>;

interface JsonSchemaDocument {
  readonly schema: JsonNode | boolean;
  readonly $defs?: Record<string, JsonNode>;
}

/**
 * Convert an Effect `Schema` to a JSON Schema node. Returns `undefined` for
 * empty/void schemas (e.g. procedures with no payload), so callers can omit the
 * request body or response content entirely.
 */
const schemaToNode = (schema: Schema.Top): JsonNode | undefined => {
  const doc = Schema.toJsonSchemaDocument(
    schema,
  ) as unknown as JsonSchemaDocument;
  const node = doc.schema;
  // `false`/`true` are valid JSON Schema booleans meaning "nothing"/"anything".
  if (typeof node === "boolean") return undefined;
  // Void/Never render as schemas with no type and no shape — skip them.
  const hasShape =
    node.type !== undefined ||
    node.properties !== undefined ||
    node.anyOf !== undefined ||
    node.allOf !== undefined ||
    node.oneOf !== undefined ||
    node.$ref !== undefined ||
    node.enum !== undefined ||
    node.const !== undefined;
  if (!hasShape) return undefined;
  if (doc.$defs && Object.keys(doc.$defs).length > 0) {
    return { ...node, $defs: doc.$defs };
  }
  return node;
};

const SECURITY = [{ cookieAuth: [] }, { bearerAuth: [] }];

export const generateOpenApiFromRpcGroups = (
  groups: readonly RpcGroupLike[],
  config: RpcOpenApiConfig,
): OpenAPIV3_1.Document => {
  const paths: Record<string, JsonNode> = {};
  const tags = new Set<string>();

  for (const group of groups) {
    // The map key is the RPC tag (e.g. "workItem.list"). `rpc.key` is the
    // effect type identifier ("effect/rpc/Rpc/...") — do NOT use it here.
    for (const [rpcTag, rpc] of group.requests.entries()) {
      const tag = rpcTag.split(".")[0] ?? "default";
      tags.add(tag);

      const requestSchema = schemaToNode(rpc.payloadSchema);
      const responseSchema = schemaToNode(rpc.successSchema);

      const operation: JsonNode = {
        tags: [tag],
        operationId: rpcTag,
        summary: rpcTag,
        security: SECURITY,
        responses: {
          "200": {
            description: "Successful response",
            ...(responseSchema
              ? { content: { "application/json": { schema: responseSchema } } }
              : {}),
          },
          "400": { description: "Invalid request payload" },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden" },
          "404": { description: "Not found" },
          "429": {
            description: "Rate limit exceeded",
            headers: {
              "RateLimit-Limit": {
                schema: { type: "integer" },
                description: "Maximum requests allowed in the current window",
              },
              "RateLimit-Remaining": {
                schema: { type: "integer" },
                description: "Requests remaining in the current window",
              },
              "RateLimit-Reset": {
                schema: { type: "integer" },
                description: "Unix timestamp when the current window resets",
              },
              "Retry-After": {
                schema: { type: "integer" },
                description: "Seconds to wait before retrying",
              },
            },
          },
        },
      };

      if (requestSchema) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: requestSchema } },
        };
      }

      const restPath = tagToRestPath(rpcTag);
      paths[restPath] = { ...paths[restPath], post: operation };
    }
  }

  const document: JsonNode = {
    openapi: "3.1.0",
    info: {
      title: config.title,
      version: config.version,
      ...(config.description ? { description: config.description } : {}),
    },
    servers: [{ url: config.baseUrl }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key bearer token",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
    },
    tags: [...tags].sort().map((name) => ({ name })),
  };

  return document as unknown as OpenAPIV3_1.Document;
};
