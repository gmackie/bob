/**
 * ForgeGraph HTTP Client
 *
 * Communicates with the ForgeGraph work-item API at forgegraf.com.
 * Follows the OpenCodeClient pattern: Bearer auth, timeouts, single retry on 5xx.
 */

import type { ForgeGraphConfig } from "./config";

// ── App types ────────────────────────────────────────────────────────

export interface FgApp {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  flakeRef: string | null;
  healthCheckUrl: string | null;
  deploymentPlatform: string | null;
  createdAt: string;
}

// ── Request/Response types ────────────────────────────────────────────

export interface FgWorkItem {
  id: string;
  kind: "issue" | "epic" | "task";
  title: string;
  description?: string | null;
  status: string;
  parentId?: string | null;
  repositoryId?: string | null;
  externalId?: string | null;
  assignee?: string | null;
  metadata?: Record<string, unknown> | null;
  changesetId?: string | null;
  lastReadinessVerdict?: string | null;
  createdAt: string;
  updatedAt: string;
  // Detail endpoint returns these:
  children?: FgWorkItem[];
  dependencies?: FgDependency[];
  artifacts?: FgArtifact[];
  recentActivity?: FgActivity[];
}

export interface FgArtifact {
  id: string;
  workItemId: string;
  producerType: string;
  producerId?: string | null;
  artifactType: string;
  artifactRole: string;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  url?: string | null;
  isCurrent: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface FgDependency {
  id: string;
  workItemId: string;
  dependsOnWorkItemId: string;
  createdAt: string;
}

export interface FgActivity {
  id: string;
  workItemId: string;
  actorId: string;
  type: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface FgReadinessVerdict {
  workItemId: string;
  verdict: "ready" | "blocked" | "incomplete" | "failed" | "not-linked" | "error";
  evidence?: unknown;
  blockers?: string[];
  nextAction?: string;
}

export interface FgDeploySecretRef {
  ref: string;
}

export interface FgDeploySecretBinding {
  key: string;
  ref: string;
  updatedAt: string;
}

// ── Input types ───────────────────────────────────────────────────────

export interface CreateWorkItemInput {
  kind: "issue" | "epic" | "task";
  title: string;
  description?: string;
  parentId?: string;
  repositoryId?: string;
  externalId?: string;
  assignee?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  changesetId?: string;
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  kind?: "issue" | "epic" | "task";
  status?: string;
  parentId?: string | null;
  repositoryId?: string | null;
  assignee?: string | null;
  actorId?: string;
}

export interface CreateArtifactInput {
  producerType: "bob" | "forgegraph" | "user" | "system";
  producerId?: string;
  artifactType: string;
  artifactRole: string;
  title?: string;
  summary?: string;
  content?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordActivityInput {
  actorId: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface ListWorkItemsFilters {
  parentId?: string;
  repositoryId?: string;
  status?: string;
  kind?: string;
  externalId?: string;
  limit?: number;
  offset?: number;
}

// ── Client ────────────────────────────────────────────────────────────

export class ForgeGraphClient {
  private config: ForgeGraphConfig;

  constructor(config: ForgeGraphConfig) {
    this.config = config;
  }

  // ── Apps ──────────────────────────────────────────────────────────

  async listApps(): Promise<FgApp[]> {
    const result = await this.get<{ apps: FgApp[] }>("/api/fg/apps");
    return result.apps;
  }

  async getApp(id: string): Promise<FgApp> {
    return this.get<FgApp>(`/api/fg/apps/${id}`);
  }

  // ── Work Items ────────────────────────────────────────────────────

  async listWorkItems(filters: ListWorkItemsFilters = {}): Promise<FgWorkItem[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    return this.get<FgWorkItem[]>(`/api/fg/work-items${qs ? `?${qs}` : ""}`);
  }

  async getWorkItem(id: string): Promise<FgWorkItem> {
    return this.get<FgWorkItem>(`/api/fg/work-items/${id}`);
  }

  async getWorkItemByExternalId(externalId: string): Promise<FgWorkItem | null> {
    const items = await this.listWorkItems({ externalId });
    return items[0] ?? null;
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<FgWorkItem> {
    return this.post<FgWorkItem>("/api/fg/work-items", input);
  }

  async updateWorkItem(id: string, input: UpdateWorkItemInput): Promise<FgWorkItem> {
    return this.patch<FgWorkItem>(`/api/fg/work-items/${id}`, input);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await this.request(`/api/fg/work-items/${id}`, { method: "DELETE" });
  }

  // ── Artifacts ─────────────────────────────────────────────────────

  async listArtifacts(
    workItemId: string,
    filters?: { type?: string; all?: boolean },
  ): Promise<FgArtifact[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.set("type", filters.type);
    if (filters?.all) params.set("all", "true");
    const qs = params.toString();
    return this.get<FgArtifact[]>(
      `/api/fg/work-items/${workItemId}/artifacts${qs ? `?${qs}` : ""}`,
    );
  }

  async createArtifact(workItemId: string, input: CreateArtifactInput): Promise<FgArtifact> {
    return this.post<FgArtifact>(`/api/fg/work-items/${workItemId}/artifacts`, input);
  }

  // ── Dependencies ──────────────────────────────────────────────────

  async listDependencies(workItemId: string): Promise<FgDependency[]> {
    return this.get<FgDependency[]>(`/api/fg/work-items/${workItemId}/dependencies`);
  }

  async addDependency(workItemId: string, dependsOnWorkItemId: string): Promise<FgDependency> {
    return this.post<FgDependency>(`/api/fg/work-items/${workItemId}/dependencies`, {
      dependsOnWorkItemId,
    });
  }

  async removeDependency(workItemId: string, dependsOnWorkItemId: string): Promise<void> {
    await this.request(`/api/fg/work-items/${workItemId}/dependencies`, {
      method: "DELETE",
      body: JSON.stringify({ dependsOnWorkItemId }),
    });
  }

  // ── Activities ────────────────────────────────────────────────────

  async listActivities(workItemId: string, limit?: number): Promise<FgActivity[]> {
    const qs = limit ? `?limit=${limit}` : "";
    return this.get<FgActivity[]>(`/api/fg/work-items/${workItemId}/activities${qs}`);
  }

  async recordActivity(workItemId: string, input: RecordActivityInput): Promise<FgActivity> {
    return this.post<FgActivity>(`/api/fg/work-items/${workItemId}/activities`, input);
  }

  // ── Changeset Linkage ─────────────────────────────────────────────

  async linkChangeset(workItemId: string, changesetId: string): Promise<void> {
    await this.request(`/api/fg/work-items/${workItemId}/link`, {
      method: "PUT",
      body: JSON.stringify({ changesetId }),
    });
  }

  async unlinkChangeset(workItemId: string): Promise<void> {
    await this.request(`/api/fg/work-items/${workItemId}/link`, { method: "DELETE" });
  }

  // ── Readiness ─────────────────────────────────────────────────────

  async getReadiness(workItemId: string): Promise<FgReadinessVerdict> {
    return this.get<FgReadinessVerdict>(
      `/api/fg/work-items/readiness?workItemId=${workItemId}`,
    );
  }

  async getBulkReadiness(workItemIds: string[]): Promise<FgReadinessVerdict[]> {
    return this.post<FgReadinessVerdict[]>("/api/fg/work-items/readiness", { workItemIds });
  }

  async upsertDeploySecret(input: {
    projectId: string;
    environment: "dev" | "staging" | "prod" | "preview";
    key: string;
    value: string;
  }): Promise<FgDeploySecretRef> {
    return this.post<FgDeploySecretRef>("/api/fg/deploy-secrets", input);
  }

  async listDeploySecrets(input: {
    projectId: string;
    environment?: "dev" | "staging" | "prod" | "preview";
  }): Promise<FgDeploySecretBinding[]> {
    const params = new URLSearchParams();
    params.set("projectId", input.projectId);
    if (input.environment) params.set("environment", input.environment);
    return this.get<FgDeploySecretBinding[]>(
      `/api/fg/deploy-secrets?${params.toString()}`,
    );
  }

  // ── HTTP helpers ──────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const resp = await this.request(path, { method: "GET" });
    return resp.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const resp = await this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return resp.json() as Promise<T>;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const resp = await this.request(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return resp.json() as Promise<T>;
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiToken}`,
      ...(options.headers as Record<string, string>),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers: headers,
        signal: controller.signal,
      });

      if (response.status >= 500 && response.status < 600) {
        // Single retry on 5xx
        clearTimeout(timeoutId);
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), this.config.timeoutMs);
        try {
          const retry = await fetch(url, {
            ...options,
            headers: headers,
            signal: retryController.signal,
          });
          if (!retry.ok) {
            const text = await retry.text().catch(() => "");
            throw new Error(`ForgeGraph ${response.status}: ${text}`);
          }
          return retry;
        } finally {
          clearTimeout(retryTimeout);
        }
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`ForgeGraph ${response.status}: ${text}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
