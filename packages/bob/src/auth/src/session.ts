import { db } from "@bob/db/client";
import { session, user } from "@bob/db/schema";

export interface SessionAuth {
  session: typeof session.$inferSelect;
  user: typeof user.$inferSelect;
}

export async function validateSessionToken(
  token: string | null | undefined,
): Promise<SessionAuth | null> {
  if (!token) return null;

  const sessionRecord = await db.query.session.findFirst({
    where: (table, { and, eq, gt }) =>
      and(eq(table.token, token), gt(table.expiresAt, new Date())),
  });

  if (!sessionRecord) return null;

  const userRecord = await db.query.user.findFirst({
    where: (table, { eq }) => eq(table.id, sessionRecord.userId),
  });

  if (!userRecord) return null;

  return {
    session: sessionRecord,
    user: userRecord,
  };
}
