import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";

import { initAuth } from "@bob/auth";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { user } from "@bob/db/schema";

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

async function getOrCreateDefaultUser() {
  const id = "default-user";
  const existing = await db.query.user.findFirst({ where: eq(user.id, id) });
  if (existing) return existing;

  await db
    .insert(user)
    .values({
      id,
      email: "default-user@example.com",
      name: "Default User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  return db.query.user.findFirst({ where: eq(user.id, id) });
}

export const getSession = cache(async () => {
  if (process.env.REQUIRE_AUTH !== "true") {
    const u = await getOrCreateDefaultUser();
    return u ? ({ user: u, session: null } as any) : null;
  }

  return auth.api.getSession({ headers: await headers() });
});
