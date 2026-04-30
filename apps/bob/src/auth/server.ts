import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

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
// Legacy better-auth instance (inlined from retired `@bob/auth/initAuth`).
// Kept for `getSession` in RSC — needs the `nextCookies()` plugin for
// cookie-based session resolution in Next.js server components.
// ---------------------------------------------------------------------------
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  baseURL: baseUrl,
  secret: process.env.AUTH_SECRET,
  plugins: [expo(), nextCookies()],
  socialProviders: {
    github: {
      clientId: process.env.AUTH_GITHUB_ID ?? "",
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
      redirectURI: `${baseUrl}/api/auth/callback/github`,
      scope: ["user:email", "repo", "read:user"],
    },
  },
  trustedOrigins: Array.from(
    new Set(
      [
        "expo://",
        "bob://",
        "http://localhost:3000",
        "https://bob-web.localhost",
        baseUrl,
        ...(process.env.TRUSTED_ORIGINS?.split(",").map((o: string) => o.trim()) ?? []),
      ].filter(Boolean),
    ),
  ),
  onAPIError: {
    onError(error, ctx) {
      console.error("BETTER AUTH API ERROR", error, ctx);
    },
  },
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
