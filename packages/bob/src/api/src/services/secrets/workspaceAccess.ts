import { TRPCError } from "@trpc/server";
import { and, eq } from "@bob/db";
import { workspaceMembers, workspaces } from "@bob/db/schema";

/** The same member access used by project handlers, including legacy owners
 * whose membership row has not yet been backfilled. Never trusts caller scope. */
export interface WorkspaceAccessDatabase {
  query: {
    workspaces?: { findFirst: (args: unknown) => Promise<{ ownerUserId: string } | undefined> };
    workspaceMembers?: { findFirst: (args: unknown) => Promise<{ id: string } | undefined> };
  };
}

export async function requireWorkspaceAccess(db: WorkspaceAccessDatabase, userId: string, workspaceId: string) {
  const workspace = await db.query.workspaces?.findFirst({
    where: eq(workspaces.id, workspaceId), columns: { ownerUserId: true },
  });
  if (workspace?.ownerUserId === userId) return;
  const member = await db.query.workspaceMembers?.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    columns: { id: true },
  });
  if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
}
