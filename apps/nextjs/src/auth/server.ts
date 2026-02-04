import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";

import { initAuth } from "@bob/auth";

import { env } from "~/env";

function safeOrigin(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
}

const publicSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.FRONTEND_URL ??
  // Vercel (not used in hosted VPS mode, but keep as fallback)
  (env.VERCEL_ENV === "production"
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : env.VERCEL_ENV === "preview"
      ? `https://${env.VERCEL_URL}`
      : undefined) ??
  "http://localhost:3000";

const baseUrl = safeOrigin(publicSiteUrl);

export const auth = initAuth({
  baseUrl,
  productionUrl: safeOrigin(publicSiteUrl),
  secret: env.AUTH_SECRET,
  githubClientId: env.AUTH_GITHUB_ID,
  githubClientSecret: env.AUTH_GITHUB_SECRET,
  gitlabClientId: env.AUTH_GITLAB_ID,
  gitlabClientSecret: env.AUTH_GITLAB_SECRET,
  extraPlugins: [nextCookies()],
});

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
