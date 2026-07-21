import { eq, and } from "@bob/db";
import type { Db } from "@bob/db/client";
import { workspaceIntegrations } from "@bob/db/schema";
import type { WorkItemArtifactType } from "@bob/work-items/schema";

// =============================================================================
// Types
// =============================================================================

export interface ProviderTask {
  externalId: string;
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  url: string | null;
  labels: string[];
  assigneeId: string | null;
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
  providerProjectId: string;
  priority?: string;
  assigneeId?: string;
  labels?: string[];
  idempotencyKey?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  labels?: string[];
}

export interface TaskFilter {
  providerProjectId?: string;
  status?: string;
  assigneeId?: string;
  limit?: number;
}

export interface MilestonePayload {
  title: string;
  body: string;
}

export interface InputPromptPayload {
  promptId: string;
  question: string;
  options?: string[];
}

export interface InputResolutionPayload {
  promptId: string;
  answer: string;
}

export interface ArtifactPayload {
  type: WorkItemArtifactType;
  role: string;
  title: string;
  url?: string;
  summary?: string;
  content?: string;
}

export interface CompletionPayload {
  outcome: "success" | "failure" | "cancelled";
  summary: string;
}

export type TaskStatus =
  | "started"
  | "blocked"
  | "failed"
  | "review_ready"
  | "completed";

// =============================================================================
// Error
// =============================================================================

export class PlanningProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retriable: boolean,
  ) {
    super(message);
    this.name = "PlanningProviderError";
  }
}

// =============================================================================
// Interface
// =============================================================================

export interface PlanningProvider {
  // CRUD (Tier 1)
  createTask(input: CreateTaskInput): Promise<ProviderTask>;
  getTask(externalId: string): Promise<ProviderTask | null>;
  getTaskByIdentifier(identifier: string): Promise<ProviderTask | null>;
  listTasks(filter: TaskFilter): Promise<ProviderTask[]>;
  updateTask(externalId: string, updates: UpdateTaskInput): Promise<ProviderTask>;

  // Lifecycle (Tier 2)
  reportMilestone(externalId: string, taskRunId: string, milestone: MilestonePayload): Promise<void>;
  requestInput(externalId: string, taskRunId: string, prompt: InputPromptPayload): Promise<void>;
  resolveInput(externalId: string, taskRunId: string, resolution: InputResolutionPayload): Promise<void>;
  setStatus(externalId: string, taskRunId: string, status: TaskStatus): Promise<void>;
  attachArtifact(externalId: string, taskRunId: string, artifact: ArtifactPayload): Promise<void>;
  markReviewReady(externalId: string, taskRunId: string, summary: string): Promise<void>;
  completeTask(externalId: string, taskRunId: string, outcome: CompletionPayload): Promise<void>;
  addComment(externalId: string, taskRunId: string, body: string): Promise<void>;
}

// =============================================================================
// Factory
// =============================================================================

export interface ProjectProviderConfig {
  planningProvider: string;
  linearProjectId: string | null;
}

export async function resolvePlanningProvider(
  db: Db,
  project: ProjectProviderConfig,
  workspaceId: string,
  userId?: string,
): Promise<PlanningProvider> {
  if (project.planningProvider === "internal") {
    const { InternalPlanningProvider } = await import("./internalProvider.js");
    return new InternalPlanningProvider(db, workspaceId, userId);
  }

  if (project.planningProvider === "linear") {
    const integration = await db
      .select()
      .from(workspaceIntegrations)
      .where(
        and(
          eq(workspaceIntegrations.workspaceId, workspaceId),
          eq(workspaceIntegrations.provider, "linear"),
          eq(workspaceIntegrations.enabled, true),
        ),
      )
      .then((rows) => rows[0]);

    if (!integration) {
      throw new PlanningProviderError(
        "Linear integration not configured for this workspace",
        "INTEGRATION_NOT_CONFIGURED",
        false,
      );
    }

    if (!integration.apiKey) {
      throw new PlanningProviderError(
        "Linear API key not set for this workspace",
        "API_KEY_MISSING",
        false,
      );
    }

    if (!integration.linearTeamId) {
      throw new PlanningProviderError(
        "Linear team ID not configured for this workspace",
        "TEAM_ID_MISSING",
        false,
      );
    }

    if (!project.linearProjectId) {
      throw new PlanningProviderError(
        "Linear project not mapped for this project",
        "PROJECT_NOT_MAPPED",
        false,
      );
    }

    const { LinearPlanningProvider } = await import("./linearProvider.js");
    return new LinearPlanningProvider(
      db,
      integration.apiKey,
      integration.linearTeamId,
      project.linearProjectId,
      integration.linearWebBaseUrl,
      integration.linearApiUrl,
    );
  }

  throw new PlanningProviderError(
    `Unknown planning provider: ${project.planningProvider}`,
    "UNKNOWN_PROVIDER",
    false,
  );
}
