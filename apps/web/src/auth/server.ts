import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";

import { initAuth } from "@bob/auth";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { user } from "@bob/db/schema";

import { env } from "~/env";

type DefaultUser = NonNullable<
  Awaited<ReturnType<typeof getOrCreateDefaultUser>>
>;

type DefaultSession = {
  user: DefaultUser;
  session: null;
};

type BetterAuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
type SessionResult = BetterAuthSession | DefaultSession;

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
  "http://localhost:3000";

const baseUrl = safeOrigin(publicSiteUrl);

// Debug: log the resolved auth base URL on startup
console.log(`[auth] Base URL resolved to: ${baseUrl} (FRONTEND_URL=${process.env.FRONTEND_URL}, NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL})`);

export const auth = initAuth({
  baseUrl,
  productionUrl: baseUrl,
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

export const getSession = cache(async (): Promise<SessionResult> => {
  if (process.env.REQUIRE_AUTH !== "true") {
    const u = await getOrCreateDefaultUser();
    return u ? { user: u, session: null } : null;
  }

  return auth.api.getSession({ headers: await headers() });
});
