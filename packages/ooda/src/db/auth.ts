import { and, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { sessions, users } from "./schema/auth";

export class SessionNotFoundError extends Error {
  constructor() {
    super("Session not found or expired");
    this.name = "SessionNotFoundError";
  }
}

/**
 * Validate a session token against the better-auth sessions table.
 * Returns the userId and email if the session is valid and not expired.
 * Throws SessionNotFoundError otherwise.
 */
export async function validateSessionToken(
  db: PostgresJsDatabase<Record<string, unknown>>,
  token: string,
): Promise<{ userId: string; email: string }> {
  const rows = await db
    .select({
      userId: sessions.userId,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) throw new SessionNotFoundError();
  return { userId: row.userId, email: row.email };
}

/**
 * Extract a session token from request headers.
 * Checks Authorization: Bearer <token> first, then cookie names
 * used by better-auth.
 */
export function extractSessionToken(headers: Headers): string | null {
  // 1. Authorization: Bearer <token>
  const auth = headers.get("authorization");
  if (auth) {
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      const token = trimmed.slice(7).trim();
      if (token) return token;
    }
  }

  // 2. Cookie: better-auth.session_token=<token> or session=<token>
  const cookie = headers.get("cookie");
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (
        name === "better-auth.session_token" ||
        name === "session"
      ) {
        const value = rest.join("=").trim();
        if (value) return value;
      }
    }
  }

  return null;
}

export { sessions, users } from "./schema/auth";
