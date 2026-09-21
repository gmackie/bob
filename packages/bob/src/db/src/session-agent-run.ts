import { asc, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { agentRuns, chatConversations } from "./schema.js";

/** Both gateway claims and runner reports must use this registration path.
 * Lock the shared session row before checking/inserting: the two processes can
 * race, and a check followed by an unguarded insert creates duplicate runs.
 * Existing outcomes are returned unchanged, including after reconnect/retry.
 */
export async function registerSessionAgentRun(
  db: Db,
  input: typeof agentRuns.$inferInsert & { sessionId: string },
) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select({ id: chatConversations.id })
      .from(chatConversations).where(eq(chatConversations.id, input.sessionId))
      .for("update");
    if (!session) throw new Error("Session not found while registering run");
    const existing = await tx.query.agentRuns.findFirst({
      where: eq(agentRuns.sessionId, input.sessionId),
      orderBy: asc(agentRuns.createdAt),
    });
    if (existing) {
      if (existing.workspaceId !== input.workspaceId || existing.tenantId !== input.tenantId || existing.workItemId !== input.workItemId) {
        throw new Error("Session run ownership mismatch");
      }
      return existing;
    }
    const [run] = await tx.insert(agentRuns).values(input).returning();
    if (!run) throw new Error("Failed to register session run");
    return run;
  });
}
