// WorkItemKind type is re-exported from ./schema (DB enum source of truth).
import type { WorkItemKind } from "./schema";
export type { WorkItemKind };

export {
  resolveAgentType,
  DEFAULT_AGENT_TYPE,
  type ResolveAgentTypeInput,
} from "./resolve-agent-type";

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
export {
  activityRecordSchema,
  artifactRecordSchema,
  commentRecordSchema,
  createArtifactInputSchema,
  createCommentInputSchema,
  createNotificationInputSchema,
  getWorkItemInputSchema,
  getWorkItemOutputSchema,
  listActivitiesInputSchema,
  listChildArtifactGroupsInputSchema,
  listChildArtifactGroupsOutputSchema,
  listCommentsInputSchema,
  listCurrentArtifactsInputSchema,
  listNotificationsInputSchema,
  listNotificationsOutputSchema,
  listWorkItemsInputSchema,
  markNotificationAsReadInputSchema,
  notificationRecordSchema,
  projectSummarySchema,
  promoteToTaskInputSchema,
  updateWorkItemInputSchema,
  workItemArtifactProducerType,
  workItemArtifactType,
  workItemNotificationType,
  workItemRecordSchema,
} from "./schema";
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
  UpdateWorkItemInput,
  UpdateWorkItemResult,
  WorkItemsClient,
  WorkItemsClientOptions,
  WorkItemsRestPath,
} from "./client";
