// Bob / Kanbanger buddy tools. Unlike the research tools (which go through
// ctx.trpc.research), these call Bob's public REST API directly from the runner
// process, using the runner env: BOB_API_URL, BOB_API_KEY (a bob_* key), and
// BOB_WORKSPACE_ID. This is the "turn the conversation into project work" path.
import { ToolHandlerError } from "../handler.js";
import type { ToolHandler } from "../handler.js";

interface BobConfig {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
}

function bobConfig(): BobConfig {
  const apiUrl = process.env.BOB_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.BOB_API_KEY;
  const workspaceId = process.env.BOB_WORKSPACE_ID;
  if (!apiUrl || !apiKey || !workspaceId) {
    throw new ToolHandlerError(
      "NOT_CONFIGURED",
      "Bob is not configured (need BOB_API_URL, BOB_API_KEY, BOB_WORKSPACE_ID).",
    );
  }
  return { apiUrl, apiKey, workspaceId };
}

async function bobFetch(
  cfg: BobConfig,
  path: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ToolHandlerError(
      res.status === 403 ? "FORBIDDEN" : "BOB_ERROR",
      `Bob API ${res.status}: ${detail.slice(0, 300)}`,
      { retryable: res.status >= 500 },
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

export const bob_list_projects: ToolHandler<"bob_list_projects"> = async () => {
  const cfg = bobConfig();
  const data = await bobFetch(
    cfg,
    `/api/v1/projects?workspaceId=${encodeURIComponent(cfg.workspaceId)}`,
    { method: "GET" },
  );
  const projects = Array.isArray(data.projects) ? data.projects : [];
  return {
    projects: projects.map((p) => {
      const proj = p as Record<string, unknown>;
      return {
        id: String(proj.id ?? ""),
        key: String(proj.key ?? ""),
        name: String(proj.name ?? ""),
        status: proj.status == null ? null : String(proj.status),
      };
    }),
  };
};

export const bob_create_task: ToolHandler<"bob_create_task"> = async (args) => {
  const cfg = bobConfig();
  const data = await bobFetch(cfg, `/api/v1/work-items/create`, {
    method: "POST",
    body: JSON.stringify({
      workspaceId: cfg.workspaceId,
      projectId: args.projectId,
      title: args.title,
      description: args.description,
    }),
  });
  return {
    workItemId: String(data.workItemId ?? ""),
    title: String(data.title ?? args.title),
    status: String(data.status ?? "backlog"),
  };
};

export const bob_create_project: ToolHandler<"bob_create_project"> = async (
  args,
) => {
  const cfg = bobConfig();
  const data = await bobFetch(cfg, `/api/v1/projects`, {
    method: "POST",
    body: JSON.stringify({
      workspaceId: cfg.workspaceId,
      name: args.name,
      description: args.description,
      tasks: args.tasks,
    }),
  });
  const workItems = Array.isArray(data.workItems) ? data.workItems : [];
  return {
    projectId: String(data.projectId ?? ""),
    key: String(data.key ?? ""),
    name: String(data.name ?? args.name),
    taskCount: workItems.length,
  };
};
