/**
 * Auto-generate an OpenAPI 3.1 document by introspecting a tRPC router tree.
 *
 * This walks the router record (the raw object of procedures and sub-routers)
 * and generates paths from procedure names, types, and input Zod schemas.
 * No `.meta()` annotations are required on individual procedures.
 *
 * Works with tRPC v11 where:
 *  - A procedure has `_def.procedure === true`, `_def.type`, and `_def.inputs`
 *  - A router   has `_def.router === true` and `_def.record` / `_def.procedures`
 *  - A plain router record is a plain object whose values are procedures/records
 */
import { z } from "zod/v4";
import type { OpenAPIV3_1 } from "openapi-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcedureInfo {
  /** Dot-separated path, e.g. "workItems.list" */
  path: string;
  /** query → GET, mutation → POST */
  type: "query" | "mutation";
  /** The first segment of the path, used as the OpenAPI tag */
  tag: string;
  /** The Zod input schema (if any) attached to the procedure */
  inputSchema?: z.ZodTypeAny;
}

export interface RouterOpenApiConfig {
  title: string;
  version: string;
  description?: string;
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Convert a dot-separated procedure path to a REST-style URL.
 * e.g. "workItems.listComments" → "/api/v1/work-items/list-comments"
 */
function toRestPath(procedurePath: string): string {
  const parts = procedurePath.split(".").map(camelToKebab);
  return `/api/v1/${parts.join("/")}`;
}

/**
 * Detect whether a value is a tRPC procedure (built via `.query()` / `.mutation()`).
 * Note: tRPC procedures are callable functions with a `_def` property.
 */
function isProcedure(
  value: unknown,
): value is { _def: { procedure: true; type: string; inputs: unknown[] } } {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return false;
  const def = (value as Record<string, unknown>)._def as
    | Record<string, unknown>
    | undefined;
  return (
    def?.procedure === true &&
    (def.type === "query" || def.type === "mutation" || def.type === "subscription")
  );
}

/**
 * Detect whether a value is a tRPC router (created via `createTRPCRouter()`).
 */
function isRouter(
  value: unknown,
): value is { _def: { router: true; record: Record<string, unknown> } } {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return false;
  const def = (value as Record<string, unknown>)._def as
    | Record<string, unknown>
    | undefined;
  return def?.router === true && typeof def.record === "object";
}

/**
 * Try to extract a Zod schema from a tRPC procedure's `_def.inputs` array.
 * tRPC stores each `.input()` call as a parser in the `inputs` array.
 * When there is a single input, we use it directly.
 * When there are multiple, we try to intersect them (tRPC merges inputs).
 */
function extractInputSchema(inputs: unknown[]): z.ZodTypeAny | undefined {
  const zodSchemas: z.ZodTypeAny[] = [];

  for (const input of inputs) {
    if (isZodSchema(input)) {
      zodSchemas.push(input as z.ZodTypeAny);
    }
  }

  const [first, second] = zodSchemas;
  if (zodSchemas.length === 0 || !first) return undefined;
  if (zodSchemas.length === 1 || !second) return first;

  // Multiple inputs → intersection
  return z.intersection(first, second);
}

/**
 * Best-effort check for whether a value is a Zod schema.
 * Zod v4 uses `_zod` as a brand, Zod v3 uses `_def`.
 */
function isZodSchema(value: unknown): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return false;
  const v = value as Record<string, unknown>;
  // Zod v4 check
  if ("_zod" in v) return true;
  // Zod v3 check (some schemas created via zod/v4 may still use _def internally)
  if (
    "_def" in v &&
    typeof v._def === "object" &&
    v._def !== null &&
    "typeName" in (v._def as Record<string, unknown>)
  ) {
    return true;
  }
  // Standard schema check (tRPC also supports standard schemas)
  if ("~standard" in v) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Core: Extract procedures from a router record / router
// ---------------------------------------------------------------------------

/**
 * Walk a tRPC router record (or wrapped router) and extract all procedures
 * with their paths, types, and input schemas.
 */
export function extractProcedures(
  record: Record<string, unknown>,
  parentPath = "",
  tag = "",
): ProcedureInfo[] {
  const results: ProcedureInfo[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (
      !value ||
      (typeof value !== "object" && typeof value !== "function")
    )
      continue;

    const currentPath = parentPath ? `${parentPath}.${key}` : key;
    const currentTag = tag || key;

    if (isProcedure(value)) {
      const def = value._def;

      // Skip subscriptions — they don't map well to REST
      if (def.type === "subscription") continue;

      results.push({
        path: currentPath,
        type: def.type as "query" | "mutation",
        tag: currentTag,
        inputSchema: extractInputSchema(def.inputs),
      });
    } else if (isRouter(value)) {
      // Wrapped router: recurse into _def.record
      results.push(
        ...extractProcedures(
          value._def.record,
          currentPath,
          currentTag,
        ),
      );
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Could be a plain router record (an object whose values are procedures)
      const val = value as Record<string, unknown>;

      // Skip if it has a _def — it's a procedure or router we didn't recognize
      if ("_def" in val) continue;

      // Check if any direct children are procedures or routers
      const hasChildren = Object.values(val).some(
        (v) => isProcedure(v) || isRouter(v) || isPlainRouterRecord(v),
      );

      if (hasChildren) {
        results.push(
          ...extractProcedures(val, currentPath, currentTag),
        );
      }
    }
  }

  return results;
}

/**
 * Check whether a value looks like a plain router record
 * (not a procedure, not a wrapped router, but has procedure-like children).
 */
function isPlainRouterRecord(value: unknown): boolean {
  if (
    !value ||
    (typeof value !== "object" && typeof value !== "function") ||
    Array.isArray(value)
  )
    return false;
  const v = value as Record<string, unknown>;
  if ("_def" in v) return false;
  return Object.values(v).some((child) => isProcedure(child));
}

// ---------------------------------------------------------------------------
// Document generator
// ---------------------------------------------------------------------------

/**
 * Generate a full OpenAPI 3.1 document from a tRPC router record.
 *
 * @param routerOrRecord - Either a wrapped tRPC router (with `_def.record`)
 *   or a raw `TRPCRouterRecord` object.
 * @param config - Document metadata (title, version, baseUrl).
 */
export function generateOpenApiFromRouter(
  routerOrRecord: Record<string, unknown>,
  config: RouterOpenApiConfig,
): OpenAPIV3_1.Document {
  // If we got a wrapped router, extract its record
  const record = isRouter(routerOrRecord)
    ? (routerOrRecord._def.record)
    : routerOrRecord;

  const procedures = extractProcedures(record);
  const paths: Record<string, OpenAPIV3_1.PathItemObject> = {};
  const tagSet = new Set<string>();

  for (const proc of procedures) {
    const method = proc.type === "query" ? "get" : "post";
    const restPath = toRestPath(proc.path);
    tagSet.add(proc.tag);

    const operation: OpenAPIV3_1.OperationObject = {
      tags: [proc.tag],
      operationId: proc.path,
      summary: proc.path,
      responses: {
        "200": { description: "Successful response" },
        "401": { description: "Unauthorized" },
      },
    };

    if (proc.inputSchema) {
      try {
        const jsonSchema = z.toJSONSchema(proc.inputSchema) as OpenAPIV3_1.SchemaObject;

        if (method === "get") {
          // For GET requests, extract top-level properties as query parameters
          const properties = (jsonSchema.properties ?? {}) as Record<
            string,
            OpenAPIV3_1.SchemaObject
          >;
          const required = jsonSchema.required ?? [];

          operation.parameters = Object.entries(properties).map(
            ([name, schema]) =>
              ({
                name,
                in: "query",
                required: required.includes(name),
                schema,
              }) as OpenAPIV3_1.ParameterObject,
          );
        } else {
          // For POST requests, use JSON body
          operation.requestBody = {
            required: true,
            content: { "application/json": { schema: jsonSchema } },
          };
        }
      } catch {
        // Schema conversion failed — emit the operation without input details
      }
    }

    paths[restPath] = { ...paths[restPath], [method]: operation };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: config.title,
      version: config.version,
      ...(config.description ? { description: config.description } : {}),
    },
    servers: [{ url: config.baseUrl, description: "API Server" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
    },
    tags: [...tagSet]
      .sort()
      .map((t) => ({ name: t })),
  };
}
