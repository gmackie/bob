import { cache } from "react";
import { headers } from "next/headers";

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

export const authBundle: AuthRuntimeBundle = createAuthRuntime({
  db,
  schema: bobSchema as unknown as Record<string, unknown>,
  pluralizeTables: true,
  baseUrl,
  productionUrl: baseUrl,
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  githubScopes: ["user:email", "repo", "read:user"],
  cookieDomain: ".blder.bot",
  trustedOrigins: [
    "https://blder.bot",
    "https://bob.blder.bot",
    "https://ooda.blder.bot",
    ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
  ],
});

// Re-export the auth instance for the /api/auth/[...all] route handler.
export const auth = authBundle.authInstance;

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
