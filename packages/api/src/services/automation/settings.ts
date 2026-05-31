import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { projects, repositories, workItems } from "@bob/db/schema";

export type AutomationSetting =
  | "autoDispatch"
  | "autoBranch"
  | "autoPR"
  | "autoFeaturePR"
  | "ciTrigger";

type AutomationSettings = {
  autoDispatch?: boolean;
  autoBranch?: boolean;
  autoPR?: boolean;
  autoFeaturePR?: boolean;
  ciTrigger?: boolean;
};

export function isAutomationEnabled(
  settings: AutomationSettings | null | undefined,
  key: AutomationSetting,
): boolean {
  return settings?.[key] ?? true;
}

export async function isProjectAutomationEnabled(
  projectId: string | null | undefined,
  key: AutomationSetting,
): Promise<boolean> {
  if (!projectId) return false;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { automationSettings: true },
  });

  return isAutomationEnabled(project?.automationSettings, key);
}

export async function isWorkItemAutomationEnabled(
  workItemId: string | null | undefined,
  key: AutomationSetting,
  fallbackProjectId?: string | null,
): Promise<boolean> {
  if (fallbackProjectId) {
    return isProjectAutomationEnabled(fallbackProjectId, key);
  }

  if (!workItemId) return false;

  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { projectId: true },
  });

  if (!workItem) return true;

  return isProjectAutomationEnabled(workItem?.projectId, key);
}

export async function isRepositoryAutomationEnabled(
  repositoryId: string | null | undefined,
  key: AutomationSetting,
): Promise<boolean> {
  if (!repositoryId) return false;

  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    columns: { planningProjectId: true },
  });

  if (!repository) return true;
  if (!repository.planningProjectId) return true;

  return isProjectAutomationEnabled(repository?.planningProjectId, key);
}
