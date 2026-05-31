export interface ProjectWorkItem {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  kind: string;
  priority: string;
  parentId: string | null;
  updatedAt: string | null;
}

export interface RequirementTarget {
  id: string;
  identifier: string;
  title: string;
  kind: string;
  parentId: string | null;
}

export function getRequirementTargets(
  items: ProjectWorkItem[],
): RequirementTarget[] {
  return items
    .filter((item) => item.kind === "epic" || item.kind === "issue")
    .sort((a, b) => {
      if (!a.parentId && b.parentId) return -1;
      if (a.parentId && !b.parentId) return 1;
      if (a.kind !== b.kind) return a.kind === "epic" ? -1 : 1;
      return a.identifier.localeCompare(b.identifier, undefined, {
        numeric: true,
      });
    })
    .map((item) => ({
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      kind: item.kind,
      parentId: item.parentId,
    }));
}
