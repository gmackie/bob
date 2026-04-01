import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";

import { initAuth } from "@bob/auth";

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

export const auth = initAuth({
  baseUrl,
  productionUrl: baseUrl,
  secret: process.env.AUTH_SECRET,
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  extraPlugins: [nextCookies()],
});

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
