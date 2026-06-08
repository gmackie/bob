import { LinearClient } from "@linear/sdk";
import { eq } from "@bob/db";
import { taskRuns, workItemArtifacts } from "@bob/db/schema";

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
import { rewriteLinearWebUrl } from "./linearUrls.js";

export class LinearPlanningProvider implements PlanningProvider {
  private client: LinearClient;

  constructor(
    private db: any,
    apiKey: string,
    private teamId: string,
    private projectId: string,
    private linearWebBaseUrl?: string | null,
  ) {
    this.client = new LinearClient({ apiKey });
  }

  // ===========================================================================
  // CRUD (Tier 1) — throw on failure
  // ===========================================================================

  async createTask(input: CreateTaskInput): Promise<ProviderTask> {
    try {
      const payload: Parameters<LinearClient["createIssue"]>[0] = {
        teamId: this.teamId,
        title: input.title,
        description: input.description ?? undefined,
        projectId: input.providerProjectId || this.projectId,
        priority: input.priority ? this.mapPriorityToLinear(input.priority) : undefined,
        assigneeId: input.assigneeId ?? undefined,
        labelIds: input.labels,
      };

      const result = await this.client.createIssue(payload);
      const issue = await result.issue;

      if (!issue) {
        throw new PlanningProviderError(
          "Linear createIssue returned no issue",
          "CREATE_FAILED",
          false,
        );
      }

      return this.mapIssueToProviderTask(issue);
    } catch (error) {
      throw this.wrapError(error, "createTask");
    }
  }

  async getTask(externalId: string): Promise<ProviderTask | null> {
    try {
      const issue = await this.client.issue(externalId);
      return this.mapIssueToProviderTask(issue);
    } catch (error: any) {
      if (error?.message?.includes("not found") || error?.extensions?.code === "NOT_FOUND") {
        return null;
      }
      throw this.wrapError(error, "getTask");
    }
  }

  async getTaskByIdentifier(identifier: string): Promise<ProviderTask | null> {
    try {
      const result = await this.client.issueSearch({ query: identifier, first: 1 });
      const issues = result.nodes;
      if (issues.length === 0) return null;
      return this.mapIssueToProviderTask(issues[0]!);
    } catch (error) {
      throw this.wrapError(error, "getTaskByIdentifier");
    }
  }

  async listTasks(filter: TaskFilter): Promise<ProviderTask[]> {
    try {
      const issues = await this.client.issues({
        first: filter.limit ?? 50,
        filter: {
          team: { id: { eq: this.teamId } },
          project: { id: { eq: filter.providerProjectId || this.projectId } },
          ...(filter.assigneeId && { assignee: { id: { eq: filter.assigneeId } } }),
        },
      });
      return Promise.all(issues.nodes.map((issue) => this.mapIssueToProviderTask(issue)));
    } catch (error) {
      throw this.wrapError(error, "listTasks");
    }
  }

  async updateTask(externalId: string, updates: UpdateTaskInput): Promise<ProviderTask> {
    try {
      const payload: Record<string, unknown> = {};
      if (updates.title !== undefined) payload.title = updates.title;
      if (updates.description !== undefined) payload.description = updates.description ?? "";
      if (updates.priority !== undefined) payload.priority = this.mapPriorityToLinear(updates.priority);
      if (updates.assigneeId !== undefined) payload.assigneeId = updates.assigneeId;
      if (updates.labels !== undefined) payload.labelIds = updates.labels;

      await this.client.updateIssue(externalId, payload);
      const issue = await this.client.issue(externalId);
      return this.mapIssueToProviderTask(issue);
    } catch (error) {
      throw this.wrapError(error, "updateTask");
    }
  }

  // ===========================================================================
  // Lifecycle (Tier 2) — never throw, append to sync_failures
  // ===========================================================================

  async reportMilestone(externalId: string, taskRunId: string, milestone: MilestonePayload): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "reportMilestone", async () => {
      await this.postComment(externalId, taskRunId, "Milestone reached", milestone.body);
    });
  }

  async requestInput(externalId: string, taskRunId: string, prompt: InputPromptPayload): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "requestInput", async () => {
      const optionsText = prompt.options?.length
        ? `\n\nOptions:\n${prompt.options.map((o) => `- ${o}`).join("\n")}`
        : "";
      await this.postComment(externalId, taskRunId, "Input requested", `${prompt.question}${optionsText}`);
    });
  }

  async resolveInput(externalId: string, taskRunId: string, resolution: InputResolutionPayload): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "resolveInput", async () => {
      await this.postComment(externalId, taskRunId, "Input resolved", resolution.answer);
    });
  }

  async setStatus(externalId: string, taskRunId: string, status: TaskStatus): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "setStatus", async () => {
      if (status === "blocked" || status === "failed") {
        const label = status === "blocked" ? "Task blocked" : "Task failed";
        await this.postComment(externalId, taskRunId, label, `Task is now ${status}.`);
        return;
      }

      const stateId = await this.resolveLinearState(status);
      if (stateId) {
        await this.client.updateIssue(externalId, { stateId });
      }
    });
  }

  async attachArtifact(externalId: string, taskRunId: string, artifact: ArtifactPayload): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "attachArtifact", async () => {
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

      const link = artifact.url ? ` [${artifact.title || "Link"}](${artifact.url})` : "";
      await this.postComment(externalId, taskRunId, `Artifact: ${artifact.title || artifact.type}`, `${artifact.summary || ""}${link}`);
    });
  }

  async markReviewReady(externalId: string, taskRunId: string, summary: string): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "markReviewReady", async () => {
      const stateId = await this.resolveLinearState("review_ready");
      if (stateId) {
        await this.client.updateIssue(externalId, { stateId });
      }
      await this.postComment(externalId, taskRunId, "Ready for review", summary);
    });
  }

  async completeTask(externalId: string, taskRunId: string, outcome: CompletionPayload): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "completeTask", async () => {
      if (outcome.outcome === "success") {
        const stateId = await this.resolveLinearState("completed");
        if (stateId) {
          await this.client.updateIssue(externalId, { stateId });
        }
      }
      const prefix = outcome.outcome === "success" ? "Completed" : outcome.outcome === "failure" ? "Failed" : "Cancelled";
      await this.postComment(externalId, taskRunId, prefix, outcome.summary);
    });
  }

  async addComment(externalId: string, taskRunId: string, body: string): Promise<void> {
    await this.lifecycleWithFallback(externalId, taskRunId, "addComment", async () => {
      await this.postComment(externalId, taskRunId, "Note", body);
    });
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async lifecycleWithFallback(
    externalId: string,
    taskRunId: string,
    method: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error: any) {
      const failure = {
        method,
        error: error?.message ?? String(error),
        timestamp: new Date().toISOString(),
      };

      try {
        const run = await this.db
          .select({ syncFailures: taskRuns.syncFailures })
          .from(taskRuns)
          .where(eq(taskRuns.id, taskRunId))
          .then((rows: any[]) => rows[0]);

        const existing = (run?.syncFailures ?? []) as Array<{ method: string; error: string; timestamp: string }>;
        existing.push(failure);

        await this.db
          .update(taskRuns)
          .set({ syncFailures: existing })
          .where(eq(taskRuns.id, taskRunId));
      } catch (dbError) {
        console.error(`[LinearProvider] Failed to record sync failure for ${method}:`, dbError);
      }
    }
  }

  private async postComment(externalId: string, taskRunId: string, title: string, body: string): Promise<void> {
    const formatted = `**🤖 Bob — ${title}**\n${body}\n\n---\n*Automated by Bob execution run \`${taskRunId}\`*`;
    await this.client.createComment({ issueId: externalId, body: formatted });
  }

  private async resolveLinearState(status: TaskStatus): Promise<string | null> {
    const stateMap: Record<string, string> = {
      started: "In Progress",
      review_ready: "In Review",
      completed: "Done",
    };

    const targetName = stateMap[status];
    if (!targetName) return null;

    const team = await this.client.team(this.teamId);
    const states = await team.states();
    const match = states.nodes.find(
      (s) => s.name.toLowerCase() === targetName.toLowerCase(),
    );
    return match?.id ?? null;
  }

  private async findWorkItemIdFromTaskRun(taskRunId: string): Promise<string> {
    const run = await this.db
      .select({ workItemId: taskRuns.workItemId })
      .from(taskRuns)
      .where(eq(taskRuns.id, taskRunId))
      .then((rows: any[]) => rows[0]);

    if (!run?.workItemId) {
      throw new Error(`No workItemId found for taskRun ${taskRunId}`);
    }
    return run.workItemId;
  }

  private mapIssueToProviderTask(issue: any): ProviderTask {
    return {
      externalId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? null,
      status: issue.state?.name ?? "Unknown",
      priority: this.mapPriorityFromLinear(issue.priority),
      url: rewriteLinearWebUrl(issue.url ?? null, this.linearWebBaseUrl),
      labels: issue.labels?.nodes?.map((l: any) => l.name) ?? [],
      assigneeId: issue.assignee?.id ?? null,
    };
  }

  private mapPriorityToLinear(priority: string): number {
    switch (priority) {
      case "urgent": return 1;
      case "high": return 2;
      case "medium": return 3;
      case "low": return 4;
      default: return 0;
    }
  }

  private mapPriorityFromLinear(priority: number): string {
    switch (priority) {
      case 1: return "urgent";
      case 2: return "high";
      case 3: return "medium";
      case 4: return "low";
      default: return "no_priority";
    }
  }

  private wrapError(error: unknown, method: string): PlanningProviderError {
    if (error instanceof PlanningProviderError) return error;

    const message = error instanceof Error ? error.message : String(error);
    const isRateLimit = message.includes("429") || message.includes("rate limit");
    const isServerError = message.includes("500") || message.includes("502") || message.includes("503");

    return new PlanningProviderError(
      `Linear API error in ${method}: ${message}`,
      isRateLimit ? "RATE_LIMITED" : isServerError ? "SERVER_ERROR" : "API_ERROR",
      isRateLimit || isServerError,
    );
  }
}
