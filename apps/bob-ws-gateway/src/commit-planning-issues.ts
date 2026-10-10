import type { CommitPlanningDraftsResult } from "@bob/api/services/integrations/commitPlanningDrafts";

export async function commitSessionPlanningIssues(
  sessionId: string,
): Promise<CommitPlanningDraftsResult> {
  const { commitOpenPlanningDrafts } = await import(
    "@bob/api/services/integrations/commitPlanningDrafts"
  );
  const { db } = await import("@bob/db/client");
  return commitOpenPlanningDrafts(db, sessionId);
}
