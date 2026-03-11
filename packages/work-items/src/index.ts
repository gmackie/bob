export type WorkItemKind = "issue" | "epic" | "task";

export interface WorkItemRef {
  id: string;
  kind: WorkItemKind;
}

export interface WorkItemParentRef extends WorkItemRef {
  relationship: "parent";
}

export function isExecutableWorkItem(kind: WorkItemKind): boolean {
  return kind === "task";
}
