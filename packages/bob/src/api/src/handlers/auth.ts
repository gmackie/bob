/**
 * Auth handler functions — pure business logic extracted from the tRPC
 * auth router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { PublicHandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export function authGetSession(ctx: PublicHandlerContext): Promise<PublicHandlerContext["session"]> {
  return Promise.resolve(ctx.session);
}

export function authGetSecretMessage(): Promise<string> {
  return Promise.resolve("you can see this secret message!");
}
