import { getTaskWorkspaceHref, getWorkItemHref } from "./navigation";

interface ProjectWorkItemSummary {
  id: string;
  identifier: string;
  title: string;
  kind: "issue" | "epic" | "task";
  status: string;
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

export function getProjectWorkItemAction(input: {
  id: string;
  kind: "issue" | "epic" | "task";
}) {
  if (input.kind === "task") {
    return {
      href: getTaskWorkspaceHref(input.id),
      label: "Workspace",
    };
  }

  return {
    href: getWorkItemHref(input.id),
    label: "Details",
  };
}
