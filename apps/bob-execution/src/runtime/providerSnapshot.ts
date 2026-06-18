/**
 * Provider resolution and task detail snapshotting for the executor.
 *
 * This module resolves the planning provider (Linear or internal) and fetches
 * fresh task details at execution start. It mirrors the factory logic in
 * @bob/api's planningProvider.ts but lives here to avoid a circular dependency
 * (since @bob/api depends on @bob/execution).
 */

import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { projects, workspaceIntegrations } from "@bob/db/schema";

import type { PlanningTask } from "./taskExecutor.js";

const DEFAULT_LINEAR_WEB_BASE_URL = "https://linear.app";
const LINEAR_WEB_HOSTS = new Set(["linear.app", "www.linear.app"]);

function normalizeLinearWebBaseUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_LINEAR_WEB_BASE_URL;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(candidate);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function rewriteLinearWebUrl(
  url: string | null | undefined,
  baseUrl?: string | null,
): string | undefined {
  if (!url) return undefined;

  const normalizedBaseUrl = normalizeLinearWebBaseUrl(baseUrl);
  if (normalizedBaseUrl === DEFAULT_LINEAR_WEB_BASE_URL) return url;

  try {
    const parsedUrl = new URL(url);
    if (!LINEAR_WEB_HOSTS.has(parsedUrl.hostname)) return url;

    const parsedBase = new URL(normalizedBaseUrl);
    parsedUrl.protocol = parsedBase.protocol;
    parsedUrl.hostname = parsedBase.hostname;
    parsedUrl.port = parsedBase.port;
    parsedUrl.username = "";
    parsedUrl.password = "";
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface ProviderTaskSnapshot {
  title: string;
  description: string | null;
  identifier: string;
  url?: string;
  externalId?: string | null;
  externalProvider?: string | null;
  linearWebBaseUrl?: string | null;
  labels: string[];
  priority: number;
  assigneeId: string | null;
}

export interface ProviderResolutionResult {
  provider: string;
  snapshot: ProviderTaskSnapshot | null;
  error?: string;
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolves the planning provider for a task and fetches fresh details from it.
 *
 * - For "internal" provider: queries the local workItems table.
 * - For "linear" provider: fetches the issue from Linear's API using the
 *   workspace's stored API key.
 *
 * Returns the snapshot (or null if the task can't be found), plus any error
 * message if resolution failed non-fatally.
 */
export async function snapshotTaskFromProvider(
  task: PlanningTask,
  providerOverride?: string,
): Promise<ProviderResolutionResult> {
  // Determine which provider to use:
  // 1. Explicit override from caller
  // 2. Look up the project's configured provider
  // 3. Default to "internal"
  let provider = providerOverride ?? "internal";

  if (!providerOverride && task.projectId) {
    try {
      const project = await db
        .select({
          planningProvider: projects.planningProvider,
          linearProjectId: projects.linearProjectId,
        })
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .then((rows) => rows[0]);

      if (project?.planningProvider) {
        provider = project.planningProvider;
      }
    } catch (err) {
      console.warn("[providerSnapshot] Failed to look up project provider:", err);
    }
  }

  if (provider === "internal") {
    return snapshotFromInternal(task);
  }

  if (provider === "linear") {
    return snapshotFromLinear(task);
  }

  return { provider, snapshot: null, error: `Unknown provider: ${provider}` };
}

// =============================================================================
// Internal provider snapshot
// =============================================================================

async function snapshotFromInternal(task: PlanningTask): Promise<ProviderResolutionResult> {
  // For the internal provider, the PlanningTask object passed in by the caller
  // already contains the canonical data (it was built from workItems or
  // dispatchItems). Return it directly as the snapshot.
  return {
    provider: "internal",
    snapshot: {
      title: task.title,
      description: task.description,
      identifier: task.identifier,
      url: task.url,
      labels: task.labels,
      priority: task.priority,
      assigneeId: task.assigneeId,
    },
  };
}

// =============================================================================
// Linear provider snapshot
// =============================================================================

async function snapshotFromLinear(task: PlanningTask): Promise<ProviderResolutionResult> {
  try {
    // Resolve workspace integration for Linear credentials
    const integration = await db
      .select({
        apiKey: workspaceIntegrations.apiKey,
        linearTeamId: workspaceIntegrations.linearTeamId,
        linearWebBaseUrl: workspaceIntegrations.linearWebBaseUrl,
      })
      .from(workspaceIntegrations)
      .where(
        and(
          eq(workspaceIntegrations.workspaceId, task.workspaceId),
          eq(workspaceIntegrations.provider, "linear"),
          eq(workspaceIntegrations.enabled, true),
        ),
      )
      .then((rows) => rows[0]);

    if (!integration?.apiKey) {
      return {
        provider: "linear",
        snapshot: null,
        error: "Linear integration not configured or API key missing",
      };
    }

    // Fetch the issue from Linear using their GraphQL API
    const linearIssueId = task.externalId ?? task.id;
    const issue = await fetchLinearIssue(integration.apiKey, linearIssueId);

    if (!issue) {
      return {
        provider: "linear",
        snapshot: null,
        error: `Linear issue not found: ${linearIssueId}`,
      };
    }

    return {
      provider: "linear",
      snapshot: {
        title: issue.title,
        description: issue.description ?? null,
        identifier: issue.identifier,
        url: rewriteLinearWebUrl(issue.url, integration.linearWebBaseUrl),
        externalId: issue.id,
        externalProvider: "linear",
        linearWebBaseUrl: normalizeLinearWebBaseUrl(integration.linearWebBaseUrl),
        labels: issue.labels?.nodes?.map((l: { name: string }) => l.name) ?? [],
        priority: issue.priority ?? 0,
        assigneeId: issue.assignee?.id ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[providerSnapshot] Linear snapshot failed:", message);
    return {
      provider: "linear",
      snapshot: null,
      error: `Linear API error: ${message}`,
    };
  }
}

// =============================================================================
// Linear GraphQL fetch (avoids @linear/sdk dependency)
// =============================================================================

interface LinearIssueResponse {
  id: string;
  title: string;
  identifier: string;
  description: string | null;
  url: string;
  priority: number;
  assignee: { id: string } | null;
  labels: { nodes: Array<{ name: string }> };
}

async function fetchLinearIssue(
  apiKey: string,
  issueId: string,
): Promise<LinearIssueResponse | null> {
  const query = `
    query IssueSnapshot($id: String!) {
      issue(id: $id) {
        id
        title
        identifier
        description
        url
        priority
        assignee { id }
        labels { nodes { name } }
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables: { id: issueId } }),
  });

  if (!response.ok) {
    throw new Error(`Linear API returned ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    data?: { issue?: LinearIssueResponse };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    // "not found" errors are non-fatal
    const notFound = json.errors.some(
      (e) => e.message.includes("not found") || e.message.includes("Entity not found"),
    );
    if (notFound) return null;
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  return json.data?.issue ?? null;
}

// =============================================================================
// Applying snapshot to PlanningTask
// =============================================================================

/**
 * Merges a provider snapshot into the mutable PlanningTask object.
 * Only overwrites fields that the provider returned — preserves existing values
 * for anything the snapshot doesn't cover.
 */
export function applySnapshotToTask(
  task: PlanningTask,
  snapshot: ProviderTaskSnapshot,
): void {
  task.title = snapshot.title;
  task.description = snapshot.description;
  task.identifier = snapshot.identifier;
  task.labels = snapshot.labels;
  task.priority = snapshot.priority;
  task.assigneeId = snapshot.assigneeId;
  if (snapshot.url) {
    task.url = snapshot.url;
  }
  if (snapshot.externalId !== undefined) {
    task.externalId = snapshot.externalId;
  }
  if (snapshot.externalProvider !== undefined) {
    task.externalProvider = snapshot.externalProvider;
  }
  if (snapshot.linearWebBaseUrl !== undefined) {
    task.linearWebBaseUrl = snapshot.linearWebBaseUrl;
  }
}
