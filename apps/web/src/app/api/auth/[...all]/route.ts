import "server-only";

import { authInstance, ensureMigrated } from "@/server/layers";

// Better-auth's `authInstance.handler` accepts a `Request` and returns a
// `Promise<Response>`. Next.js Route Handlers expect named exports per
// HTTP verb pointing at the same shape, so we wire both GET and POST to
// the better-auth handler. `[...all]` catches every nested path under
// `/api/auth/*` (sign-in, sign-up, OAuth callbacks, sessions, etc.) so the
// underlying better-auth router sees the full request URL it expects.
//
// We sandwich `ensureMigrated()` in front of the handler — same as the
// `/api/rpc` route — because better-auth queries the gmacko `users` /
// `sessions` / `accounts` / `verifications` tables on every request.
// `ensureMigrated()` is idempotent and gated by a process-level boolean,
// so the cost after the first call is a single Map lookup.

async function withMigrations(req: Request): Promise<Response> {
  await ensureMigrated();
  return authInstance.handler(req);
}

export const GET = withMigrations;
export const POST = withMigrations;
