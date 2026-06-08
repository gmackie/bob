import { getWorkItemHref } from "./navigation";
import { getMobileProjectQueryRefreshOptions } from "./project-status";

interface ProjectWorkItemSummary {
  id: string;
  identifier: string;
  title: string;
  kind: "issue" | "epic" | "task";
  status: string;
}

export interface ProjectWorkItemRow {
  id: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  href: string;
}

export function getMobileProjectDetailQueryRefreshOptions(): {
  refetchInterval: number;
} {
  return getMobileProjectQueryRefreshOptions();
}

export function buildProjectExecutionSummary(items: ProjectWorkItemSummary[]) {
  return items.reduce(
    (acc, item) => {
      if (item.kind !== "task") {
        return acc;
      }

      if (item.status === "in_progress") acc.inProgress += 1;
      if (item.status === "in_review") acc.inReview += 1;
      if (item.status === "blocked") acc.blocked += 1;
      return acc;
    },
    { inProgress: 0, inReview: 0, blocked: 0 },
  );
}

export function buildProjectWorkItemRows(input: {
  items: ProjectWorkItemSummary[];
  workspaceId?: string | null;
}): ProjectWorkItemRow[] {
  return input.items.map((item) => {
    const action = getProjectWorkItemAction({
      id: item.id,
      kind: item.kind,
      workspaceId: input.workspaceId,
    });

    return {
      id: item.id,
      title: `${item.identifier} · ${item.title}`,
      subtitle: `${item.kind} · ${formatProjectStatus(item.status)}`,
      actionLabel: action.label,
      href: action.href,
    };
  });
}

export function getProjectWorkItemAction(input: {
  id: string;
  kind: "issue" | "epic" | "task";
  workspaceId?: string | null;
}) {
  if (input.kind === "task") {
    return {
      href: getQueueForwardWorkItemHref(input.id, input.workspaceId),
      label: "Priority Queue",
    };
  }

  return {
    href: getWorkItemHref(input.id, input.workspaceId),
    label: "Details",
  };
}

function getQueueForwardWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ view: "queue" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/work-items/${workItemId}?${params.toString()}`;
}

function formatProjectStatus(status: string): string {
  return status.replace(/_/g, " ");
}
