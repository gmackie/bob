export interface PlanningWorkItem {
  id: string;
  status: string;
  title: string;
}

export interface BoardIdentityWorkItem extends PlanningWorkItem {
  identifier?: string | null;
}

export interface PlanningProjectSummaryInput {
  project: {
    id: string;
    name: string;
    key: string;
    color: string | null;
    status: string;
  };
  counts: {
    issues: number;
    tasks: number;
    epics: number;
    active: number;
  };
}

export function groupWorkItemsByStatus<T extends PlanningWorkItem>(items: T[]) {
  return {
    backlog: items.filter(
      (item) => item.status === "draft" || item.status === "backlog",
    ),
    todo: items.filter((item) => item.status === "todo"),
    inProgress: items.filter((item) => item.status === "in_progress"),
    inReview: items.filter((item) => item.status === "in_review"),
    done: items.filter(
      (item) => item.status === "completed" || item.status === "done",
    ),
  };
}

export function dedupeWorkItemsByBoardIdentity<T extends BoardIdentityWorkItem>(
  items: T[],
): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.identifier?.trim() || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeProjects(items: PlanningProjectSummaryInput[]) {
  return items.map(({ project, counts }) => ({
    id: project.id,
    label: project.key,
    name: project.name,
    color: project.color,
    status: project.status,
    totals: `${counts.issues} issues / ${counts.tasks} tasks / ${counts.epics} epic`,
    activeLabel: `${counts.active} active`,
  }));
}
