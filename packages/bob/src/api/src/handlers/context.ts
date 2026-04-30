/**
 * Minimal context accepted by all extracted handler functions.
 *
 * Keeps handler signatures independent of the tRPC context shape so they
 * can be called from both tRPC procedures and Effect-RPC handlers.
 */
export interface HandlerContext {
  /** Database client — typed as `any` to avoid coupling to a specific Drizzle generic. */
  readonly db: any;
  /** Authenticated user's ID. */
  readonly userId: string;
}
