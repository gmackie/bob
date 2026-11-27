import type { Db } from "@bob/db/client";
import { and, eq } from "@bob/db";
import { workspaceMembers, workspaces } from "@bob/db/schema";
import type { OAuthIdentity } from "./types";

export function makeWorkspaceIdentity(db: Db, session: OAuthIdentity["session"]): OAuthIdentity {
  return {
    session,
    async workspaces(userId) {
      // Only explicit membership is offered: work-item handlers require it.
      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, userId));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        canWrite: r.role !== "viewer",
      }));
    },
    access: (userId, workspaceId, write) => hasWorkspaceAccess(db, userId, workspaceId, write),
  };
}

export async function hasWorkspaceAccess(
  db: Db,
  userId: string,
  workspaceId: string,
  write: boolean,
) {
  const row = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)),
    columns: { role: true },
  });
  return Boolean(row && (!write || row.role !== "viewer"));
}
