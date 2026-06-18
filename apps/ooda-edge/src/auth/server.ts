/**
 * OODA edge auth — validates sessions via the shared .blder.bot cookie.
 *
 * Auth endpoints (sign-in, sign-up, callback) live on the platform app
 * at blder.bot. This instance only needs to validate existing sessions
 * from the shared cookie.
 */
import { initAuth } from "@gmacko/core/auth";
import type { AuthInstance } from "@gmacko/core/auth";
import { db } from "~/lib/db-client-lazy";
import * as schema from "@gmacko/core/db/schema";

let _auth: AuthInstance | null = null;

export function getAuth(): AuthInstance {
  if (!_auth) {
    const authBaseUrl = process.env.AUTH_BASE_URL ?? "https://blder.bot";
    const trustedOrigins = [
      "https://blder.bot",
      "https://bob.blder.bot",
      "https://ooda.blder.bot",
      ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
    ];

    _auth = initAuth({
      db,
      schema: schema as unknown as Record<string, unknown>,
      pluralizeTables: true,
      baseUrl: authBaseUrl,
      productionUrl: authBaseUrl,
      secret: process.env.AUTH_SECRET ?? "",
      githubClientId: process.env.AUTH_GITHUB_ID ?? "",
      githubClientSecret: process.env.AUTH_GITHUB_SECRET ?? "",
      githubScopes: ["user:email", "repo", "read:user"],
      trustedOrigins,
      cookieDomain: ".blder.bot",
    });
  }
  return _auth;
}

export const auth = new Proxy({} as AuthInstance, {
  get(_target, prop) {
    return (getAuth() as any)[prop];
  },
});
