import "server-only";

import { authInstance } from "@/server/layers";

// Better-auth's `authInstance.handler` accepts a `Request` and returns a
// `Promise<Response>`. Next.js Route Handlers expect named exports per
// HTTP verb pointing at the same shape, so we wire both GET and POST to
// the better-auth handler. `[...all]` catches every nested path under
// `/api/auth/*` (sign-in, sign-up, OAuth callbacks, sessions, etc.) so the
// underlying better-auth router sees the full request URL it expects.
export const GET = authInstance.handler;
export const POST = authInstance.handler;
