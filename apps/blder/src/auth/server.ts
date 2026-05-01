/**
 * Platform auth server — single better-auth instance for blder.bot.
 *
 * Uses `initAuth()` from @gmacko/core/auth with cross-subdomain cookies
 * so bob.blder.bot and ooda.blder.bot share the same session.
 */
import { initAuth } from "@gmacko/core/auth";
import { db } from "~/lib/db-client-lazy";
import * as schema from "@gmacko/core/db/schema";

const publicUrl =
  process.env.FRONTEND_URL ?? "http://localhost:5173";

const trustedOrigins = [
  "https://bob.blder.bot",
  "https://ooda.blder.bot",
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
];

export const auth = initAuth({
  db,
  schema: schema as unknown as Record<string, unknown>,
  pluralizeTables: true,
  baseUrl: publicUrl,
  productionUrl: publicUrl,
  secret: process.env.AUTH_SECRET ?? "",
  githubClientId: process.env.AUTH_GITHUB_ID ?? "",
  githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
  githubScopes: ["user:email", "repo", "read:user"],
  trustedOrigins,
  cookieDomain: ".blder.bot",
});
