import { randomBytes } from "crypto";
import { eq, and, gt, lt } from "drizzle-orm";
import type { Database } from "@linear-clone/db";
import { sessions, users, type User } from "@linear-clone/db";

const SESSION_EXPIRY_DAYS = 30;

export interface SessionValidation {
  valid: boolean;
  user?: User;
  sessionId?: string;
  error?: string;
}

export interface CreatedSession {
  sessionToken: string;
  expiresAt: Date;
}

/**
 * Create a new session for a user
 */
export async function createSession(
  db: Database,
  userId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<CreatedSession> {
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  await db.insert(sessions).values({
    userId,
    sessionToken,
    userAgent,
    ipAddress,
    expiresAt,
  });

  return { sessionToken, expiresAt };
}

/**
 * Validate a session token and return the associated user
 */
export async function validateSession(
  db: Database,
  sessionToken: string
): Promise<SessionValidation> {
  if (!sessionToken) {
    return { valid: false, error: "No session token provided" };
  }

  const [result] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.sessionToken, sessionToken),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!result) {
    return { valid: false, error: "Invalid or expired session" };
  }

  return {
    valid: true,
    user: result.user,
    sessionId: result.session.id,
  };
}

/**
 * Delete a session (logout)
 */
export async function deleteSession(
  db: Database,
  sessionToken: string
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
}

/**
 * Delete all sessions for a user (logout everywhere)
 */
export async function deleteAllUserSessions(
  db: Database,
  userId: string
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Extend a session's expiration
 */
export async function extendSession(
  db: Database,
  sessionToken: string
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  await db
    .update(sessions)
    .set({ expiresAt })
    .where(eq(sessions.sessionToken, sessionToken));
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(db: Database): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning();

  return result.length;
}
