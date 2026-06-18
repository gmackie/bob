import type { PlanningTask } from "./taskExecutor.js";

export interface BobExternalTaskMetadata {
  origin: "bob";
  planningProvider: "linear" | "internal";
  linearIssueId?: string;
  linearIdentifier?: string;
  linearTitle?: string;
  linearUrl?: string;
  linearWebBaseUrl?: string;
  bobWorkspaceId: string;
  bobWorkItemId: string;
  bobTaskRunId: string;
}

function normalizePlanningProvider(provider: string): "linear" | "internal" {
  return provider === "linear" ? "linear" : "internal";
}

export function buildBobExternalTaskMetadata(input: {
  task: PlanningTask;
  planningProvider: string;
  taskRunId: string;
}): BobExternalTaskMetadata {
  const metadata: BobExternalTaskMetadata = {
    origin: "bob",
    planningProvider: normalizePlanningProvider(input.planningProvider),
    bobWorkspaceId: input.task.workspaceId,
    bobWorkItemId: input.task.id,
    bobTaskRunId: input.taskRunId,
  };

  if (
    metadata.planningProvider !== "linear" &&
    input.task.externalProvider !== "linear"
  ) {
    return metadata;
  }

  metadata.planningProvider = "linear";
  if (input.task.externalId) metadata.linearIssueId = input.task.externalId;
  metadata.linearIdentifier = input.task.identifier;
  metadata.linearTitle = input.task.title;
  if (input.task.url) metadata.linearUrl = input.task.url;
  if (input.task.linearWebBaseUrl) {
    metadata.linearWebBaseUrl = input.task.linearWebBaseUrl;
  }

  return metadata;
}
