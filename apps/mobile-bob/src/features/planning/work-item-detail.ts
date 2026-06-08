import { getTaskWorkspaceHref } from "./navigation";

interface WorkItemDetailPresentationInput {
  id: string;
  kind: "issue" | "epic" | "task";
  workspaceId?: string | null;
}

interface MobileChildDispatchItem {
  id: string;
  kind: string;
  status: string;
}

interface MobileChildDispatchRequest {
  workItemId: string;
  agentType: string;
}

const DISPATCHABLE_CHILD_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);

export function getWorkItemDetailPresentation(
  input: WorkItemDetailPresentationInput,
) {
  if (input.kind === "task") {
    return {
      primaryActionLabel: "Open execution workspace",
      executionHref: getTaskWorkspaceHref(input.id, input.workspaceId),
      semanticSummary: "Tasks are the executable unit for Bob Builder.",
      semanticHint:
        "Open the execution workspace to chat, review status, and inspect artifacts.",
    };
  }

  if (input.kind === "epic") {
    return {
      primaryActionLabel: "Promote to task",
      executionHref: getTaskWorkspaceHref(input.id, input.workspaceId),
      semanticSummary: "Epics organize work before execution begins.",
      semanticHint:
        "Promote this epic to a task when this specific item is ready for Bob.",
    };
  }

  return {
    primaryActionLabel: "Promote to task",
    executionHref: getTaskWorkspaceHref(input.id, input.workspaceId),
    semanticSummary: "Issues capture work to be shaped before execution.",
    semanticHint: "Promote this issue to a task when it is ready for Bob.",
  };
}

export function getMobileWorkItemDispatchAgentType(project: unknown): string {
  const settings = getRecord(getRecord(project)?.settings);
  const execution = getRecord(settings?.execution);
  const planning = getRecord(settings?.planning);

  return (
    normalizeMobileDispatchAgentType(execution?.provider) ??
    normalizeMobileDispatchAgentType(settings?.executionProvider) ??
    normalizeMobileDispatchAgentType(planning?.defaultAgent) ??
    normalizeMobileDispatchAgentType(settings?.defaultAgent) ??
    "codex"
  );
}

export function buildMobileChildDispatchRequests(
  items: MobileChildDispatchItem[],
  agentType: string,
): MobileChildDispatchRequest[] {
  return items
    .filter((item) => item.kind === "task" && DISPATCHABLE_CHILD_STATUSES.has(item.status))
    .map((item) => ({ workItemId: item.id, agentType }));
}

export function formatMobileDispatchAgentLabel(agentType: string): string {
  const normalized = agentType.trim().toLowerCase();
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("codex")) return "Codex";
  if (normalized.includes("claude")) return "Claude";

  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeMobileDispatchAgentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("cursor")) return "cursor-agent";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  return normalized;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
