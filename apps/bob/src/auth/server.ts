import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";

import { initAuth } from "@bob/auth";
import { createAuthRuntime, type AuthRuntimeBundle } from "@bob/auth/runtime";
import { db } from "@bob/db/client";
import * as bobSchema from "@bob/db/schema";

function safeOrigin(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
}

const publicSiteUrl =
  process.env.FRONTEND_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  "http://localhost:5173";

const baseUrl = safeOrigin(publicSiteUrl);

// ---------------------------------------------------------------------------
// Legacy better-auth instance (kept for `getSession` and backwards compat).
// Bob's `initAuth` wires `nextCookies()` plugin for cookie-based session
// resolution in Next.js RSC.
// ---------------------------------------------------------------------------
export const auth = initAuth({
  baseUrl,
  productionUrl: baseUrl,
  secret: process.env.AUTH_SECRET,
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  extraPlugins: [nextCookies()],
});

// ---------------------------------------------------------------------------
// Effect auth runtime bridge (Phase 7B-3 Task 3).
//
// The `authBundle` exposes both the ManagedRuntime (for Effect-based auth
// calls in future tasks) and the raw better-auth instance so the tRPC
// context can call `authInstance.api.getSession()` and return the full
// session shape that 370+ tRPC tests rely on.
// ---------------------------------------------------------------------------
export const authBundle: AuthRuntimeBundle = createAuthRuntime({
  db,
  schema: bobSchema as unknown as Record<string, unknown>,
  pluralizeTables: true,
  baseUrl,
  productionUrl: baseUrl,
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()),
});

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
