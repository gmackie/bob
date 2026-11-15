import type { CommitPlanningDraftsResult } from "@bob/api/services/integrations/commitPlanningDrafts";

/**
 * Planning sessions launched by the budget governor's surplus tiers (BOB-76)
 * carry `budgetTier` in their launch context. Their drafts are proposals: they
 * stay in plan_drafts until a human commits them, instead of being written to
 * the tracker as soon as the agent produces them.
 */
export function isBudgetProposalSession(launchContext: unknown): boolean {
  return (
    typeof launchContext === "object" &&
    launchContext !== null &&
    typeof (launchContext as { budgetTier?: unknown }).budgetTier === "string"
  );
}

export async function commitSessionPlanningIssues(
  sessionId: string,
): Promise<CommitPlanningDraftsResult> {
  const { commitOpenPlanningDrafts } = await import(
    "@bob/api/services/integrations/commitPlanningDrafts"
  );
  const { db } = await import("@bob/db/client");
  const session = await db.query.chatConversations.findFirst({
    where: (conversation, { eq }) => eq(conversation.id, sessionId),
    columns: { planningLaunchContext: true },
  });
  if (isBudgetProposalSession(session?.planningLaunchContext)) {
    return { committed: 0, workspaceId: null, tasks: [], retry: false };
  }
  return commitOpenPlanningDrafts(db, sessionId);
}
