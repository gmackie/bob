import type { Db } from "@bob/db/client";

/**
 * Minimal context accepted by all extracted handler functions.
 *
 * Keeps handler signatures independent of the tRPC context shape so they
 * can be called from both tRPC procedures and Effect-RPC handlers.
 */
/** Granted by a trusted local server composition root, never request JSON.
 * A workspace runner token is not authority over the API server filesystem. */
export interface LocalFilesystemCapability {
  readonly kind: "local-operator";
  readonly userId: string;
  readonly roots: readonly string[];
}

export interface HandlerContext {
  readonly filesystem?: LocalFilesystemCapability;
  /** Database client — the schema-typed Drizzle instance so `ctx.db.query.*` is typed. */
  readonly db: Db;
  /** Authenticated user's ID. */
  readonly userId: string;
  /** Tenant ID for multi-tenant scoping. Falls back to BOB_TENANT_ID env var when not set. */
  readonly tenantId?: string;
}

/**
 * Context for public (unauthenticated) handler functions.
 *
 * Same shape as `HandlerContext` but `session` is nullable — callers that
 * don't require authentication pass `null`.
 */
export interface PublicHandlerContext {
  /** Database client — the schema-typed Drizzle instance so `ctx.db.query.*` is typed. */
  readonly db: Db;
  /** Session with user info, or `null` for unauthenticated requests. */
  readonly session: { user: { id: string } } | null;
}
