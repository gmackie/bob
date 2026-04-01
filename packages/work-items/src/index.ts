export type WorkItemKind = "issue" | "epic" | "task";

export interface WorkItemRef {
  id: string;
  kind: WorkItemKind;
}

export interface WorkItemParentRef extends WorkItemRef {
  relationship: "parent";
}

export function isExecutableWorkItem(kind: WorkItemKind): boolean {
  return kind === "task";
}

export interface PromoteToTaskInput {
  id: string;
  parentId: string | null;
  title: string;
}

export function promoteToTask(input: PromoteToTaskInput) {
  return {
    ...input,
    kind: "task" as const,
  };
}

export {
  createWorkItemsClient,
  workItemsRestPaths,
  WorkItemsClientError,
} from "./client";
export type {
  CreateArtifactInput,
  CreateArtifactResult,
  CreateCommentInput,
  CreateCommentResult,
  CreateNotificationInput,
  CreateNotificationResult,
  GetWorkItemInput,
  GetWorkItemResult,
  ListActivitiesInput,
  ListActivitiesResult,
  ListChildArtifactGroupsInput,
  ListChildArtifactGroupsResult,
  ListCommentsInput,
  ListCommentsResult,
  ListCurrentArtifactsInput,
  ListCurrentArtifactsResult,
  ListNotificationsInput,
  ListNotificationsResult,
  ListWorkItemsInput,
  ListWorkItemsResult,
  MarkNotificationAsReadInput,
  MarkNotificationAsReadResult,
  PromoteToTaskInput as PromoteToTaskRestInput,
  PromoteToTaskResult,
  WorkItemsClient,
  WorkItemsClientOptions,
  WorkItemsRestPath,
} from "./client";
