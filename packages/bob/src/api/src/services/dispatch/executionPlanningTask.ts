export interface DispatchExecutionBatchLike {
  workspaceId: string;
  projectId: string;
}

export interface DispatchExecutionItemLike {
  planningTaskId: string;
  planningTaskIdentifier: string;
  title: string;
  description: string | null;
}

export interface DispatchExecutionWorkItemLike {
  externalProvider?: string | null;
  externalId?: string | null;
}

export function buildExecutionPlanningTask(input: {
  batch: DispatchExecutionBatchLike;
  item: DispatchExecutionItemLike;
  workItem?: DispatchExecutionWorkItemLike | null;
}) {
  return {
    id: input.item.planningTaskId,
    identifier: input.item.planningTaskIdentifier,
    title: input.item.title,
    description: input.item.description,
    workspaceId: input.batch.workspaceId,
    projectId: input.batch.projectId,
    assigneeId: null,
    labels: [],
    priority: 0,
    ...(input.workItem?.externalProvider
      ? { externalProvider: input.workItem.externalProvider }
      : {}),
    ...(input.workItem?.externalId ? { externalId: input.workItem.externalId } : {}),
  };
}
