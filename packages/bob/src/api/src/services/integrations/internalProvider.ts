import { eq, and, desc } from "@bob/db";
import { workItems, workItemArtifacts, taskRuns } from "@bob/db/schema";

import type {
  ArtifactPayload,
  CompletionPayload,
  CreateTaskInput,
  InputPromptPayload,
  InputResolutionPayload,
  MilestonePayload,
  PlanningProvider,
  ProviderTask,
  TaskFilter,
  TaskStatus,
  UpdateTaskInput,
} from "./planningProvider.js";
import { PlanningProviderError } from "./planningProvider.js";

export class InternalPlanningProvider implements PlanningProvider {
  constructor(private db: any, private workspaceId: string, private userId?: string) {}

  // ===========================================================================
  // CRUD (Tier 1)
  // ===========================================================================

  async createTask(input: CreateTaskInput): Promise<ProviderTask> {
    const [item] = await this.db
      .insert(workItems)
      .values({
        ownerUserId: this.userId ?? "system",
        workspaceId: this.workspaceId,
        projectId: input.providerProjectId,
        kind: "task",
        title: input.title,
        description: input.description,
        status: "draft",
      })
      .returning();

    if (!item) {
      throw new PlanningProviderError("Failed to create work item", "CREATE_FAILED", false);
    }

    return this.mapWorkItemToProviderTask(item);
  }

  async getTask(externalId: string): Promise<ProviderTask | null> {
    const item = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.id, externalId))
      .then((rows: any[]) => rows[0]);

    if (!item) return null;
    return this.mapWorkItemToProviderTask(item);
  }

  async getTaskByIdentifier(identifier: string): Promise<ProviderTask | null> {
    const item = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.id, identifier))
      .then((rows: any[]) => rows[0]);

    if (!item) return null;
    return this.mapWorkItemToProviderTask(item);
  }

  async listTasks(filter: TaskFilter): Promise<ProviderTask[]> {
    const conditions = [];

    if (filter.providerProjectId) {
      conditions.push(eq(workItems.projectId, filter.providerProjectId));
    }
    if (filter.status) {
      conditions.push(eq(workItems.status, filter.status));
    }
    if (filter.assigneeId) {
      conditions.push(eq(workItems.assigneeUserId, filter.assigneeId));
    }

    conditions.push(eq(workItems.kind, "task"));

    const items = await this.db
      .select()
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.createdAt))
      .limit(filter.limit ?? 50);

    return items.map((item: any) => this.mapWorkItemToProviderTask(item));
  }

  async updateTask(externalId: string, updates: UpdateTaskInput): Promise<ProviderTask> {
    const setValues: Record<string, unknown> = {};
    if (updates.title !== undefined) setValues.title = updates.title;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.status !== undefined) setValues.status = updates.status;
    if (updates.assigneeId !== undefined) setValues.assigneeUserId = updates.assigneeId;

    if (Object.keys(setValues).length > 0) {
      await this.db
        .update(workItems)
        .set(setValues)
        .where(eq(workItems.id, externalId));
    }

    const item = await this.db
      .select()
      .from(workItems)
      .where(eq(workItems.id, externalId))
      .then((rows: any[]) => rows[0]);

    if (!item) {
      throw new PlanningProviderError("Work item not found after update", "NOT_FOUND", false);
    }

    return this.mapWorkItemToProviderTask(item);
  }

  // ===========================================================================
  // Lifecycle (Tier 2) — real writes to local tables
  // ===========================================================================

  async reportMilestone(_externalId: string, taskRunId: string, milestone: MilestonePayload): Promise<void> {
    await this.db.insert(workItemArtifacts).values({
      workItemId: await this.findWorkItemIdFromTaskRun(taskRunId),
      taskRunId,
      producerType: "bob",
      producerId: taskRunId,
      artifactType: "doc",
      artifactRole: "documentation",
      title: milestone.title,
      content: milestone.body,
    });
  }

  async requestInput(_externalId: string, _taskRunId: string, _prompt: InputPromptPayload): Promise<void> {
    // Input prompts are handled by the execution runtime's prompt system.
    // No local write needed — the prompt is stored in the session state.
  }

  async resolveInput(_externalId: string, _taskRunId: string, _resolution: InputResolutionPayload): Promise<void> {
    // Resolution is stored in the session state by the execution runtime.
  }

  async setStatus(externalId: string, _taskRunId: string, status: TaskStatus): Promise<void> {
    const statusMap: Record<TaskStatus, string> = {
      started: "in_progress",
      blocked: "blocked",
      failed: "failed",
      review_ready: "in_review",
      completed: "done",
    };

    await this.db
      .update(workItems)
      .set({ status: statusMap[status] ?? status })
      .where(eq(workItems.id, externalId));
  }

  async attachArtifact(_externalId: string, taskRunId: string, artifact: ArtifactPayload): Promise<void> {
    await this.db.insert(workItemArtifacts).values({
      workItemId: await this.findWorkItemIdFromTaskRun(taskRunId),
      taskRunId,
      producerType: "bob",
      producerId: taskRunId,
      artifactType: artifact.type as any,
      artifactRole: artifact.role,
      url: artifact.url,
      title: artifact.title,
      summary: artifact.summary,
      content: artifact.content,
    });
  }

  async markReviewReady(externalId: string, taskRunId: string, summary: string): Promise<void> {
    await this.setStatus(externalId, taskRunId, "review_ready");
    await this.db.insert(workItemArtifacts).values({
      workItemId: await this.findWorkItemIdFromTaskRun(taskRunId),
      taskRunId,
      producerType: "bob",
      producerId: taskRunId,
      artifactType: "doc",
      artifactRole: "review",
      title: "Review summary",
      content: summary,
    });
  }

  async completeTask(externalId: string, taskRunId: string, outcome: CompletionPayload): Promise<void> {
    if (outcome.outcome === "success") {
      await this.setStatus(externalId, taskRunId, "completed");
    } else if (outcome.outcome === "failure") {
      await this.setStatus(externalId, taskRunId, "failed");
    }

    await this.db.insert(workItemArtifacts).values({
      workItemId: await this.findWorkItemIdFromTaskRun(taskRunId),
      taskRunId,
      producerType: "bob",
      producerId: taskRunId,
      artifactType: "doc",
      artifactRole: "documentation",
      title: `Task ${outcome.outcome}`,
      content: outcome.summary,
    });
  }

  async addComment(_externalId: string, taskRunId: string, body: string): Promise<void> {
    const workItemId = await this.findWorkItemIdFromTaskRun(taskRunId);

    // Comments table requires a userId — use "system" for bot-generated comments
    await this.db.insert(workItemArtifacts).values({
      workItemId,
      taskRunId,
      producerType: "bob",
      producerId: taskRunId,
      artifactType: "doc",
      artifactRole: "documentation",
      title: "Comment",
      content: body,
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async findWorkItemIdFromTaskRun(taskRunId: string): Promise<string> {
    const run = await this.db
      .select({ workItemId: taskRuns.workItemId })
      .from(taskRuns)
      .where(eq(taskRuns.id, taskRunId))
      .then((rows: any[]) => rows[0]);

    if (!run?.workItemId) {
      throw new PlanningProviderError(
        `No workItemId found for taskRun ${taskRunId}`,
        "WORK_ITEM_NOT_FOUND",
        false,
      );
    }
    return run.workItemId;
  }

  private mapWorkItemToProviderTask(item: any): ProviderTask {
    return {
      externalId: item.id,
      identifier: item.id,
      title: item.title,
      description: item.description ?? null,
      status: item.status,
      priority: "no_priority",
      url: null,
      labels: [],
      assigneeId: item.assigneeUserId ?? null,
    };
  }
}
