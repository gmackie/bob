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

export async function authGetSession(ctx: PublicHandlerContext) {
  return ctx.session;
}

export async function authGetSecretMessage() {
  return "you can see this secret message!";
}
