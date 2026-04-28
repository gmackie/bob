import { createHash } from "node:crypto";

type LegacyPlanningBase = {
  legacyId: string;
  projectId: string;
  parentLegacyId?: string;
  ownerUserId: string;
  assigneeUserId?: string;
  title: string;
  description?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

interface LegacyProjectRecord {
  id: string;
  workspaceId: string;
  key: string;
}

type LegacyIssueRecord = LegacyPlanningBase;
type LegacyEpicRecord = LegacyPlanningBase;
type LegacyTaskRecord = LegacyPlanningBase;

export interface BackfilledWorkItemRecord {
  id: string;
  legacyId: string;
  parentLegacyId: string | null;
  workspaceId: string;
  projectId: string;
  ownerUserId: string;
  assigneeUserId: string | null;
  sequenceNumber: number;
  identifier: string;
  kind: "issue" | "epic" | "task";
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function stableUuid(namespace: string, legacyId: string): string {
  const hex = createHash("sha256")
    .update(`${namespace}:${legacyId}`)
    .digest("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function buildWorkItemBackfill(input: {
  projects: LegacyProjectRecord[];
  issues: LegacyIssueRecord[];
  epics: LegacyEpicRecord[];
  tasks: LegacyTaskRecord[];
}) {
  const projectMap = new Map(input.projects.map((project) => [project.id, project]));
  const sequenceByProject = new Map<string, number>();
  const items: BackfilledWorkItemRecord[] = [];
  const legacyToWorkItemId: Record<string, string> = {};

  const orderedRecords = [
    ...input.issues.map((record) => ({ ...record, kind: "issue" as const })),
    ...input.epics.map((record) => ({ ...record, kind: "epic" as const })),
    ...input.tasks.map((record) => ({ ...record, kind: "task" as const })),
  ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  for (const record of orderedRecords) {
    const project = projectMap.get(record.projectId);

    if (!project) {
      continue;
    }

    const nextSequence = (sequenceByProject.get(project.id) ?? 0) + 1;
    sequenceByProject.set(project.id, nextSequence);

    const id = stableUuid(record.kind, record.legacyId);
    legacyToWorkItemId[record.legacyId] = id;

    items.push({
      id,
      legacyId: record.legacyId,
      parentLegacyId: record.parentLegacyId ?? null,
      workspaceId: project.workspaceId,
      projectId: project.id,
      ownerUserId: record.ownerUserId,
      assigneeUserId: record.assigneeUserId ?? null,
      sequenceNumber: nextSequence,
      identifier: `${project.key}-${nextSequence}`,
      kind: record.kind,
      title: record.title,
      description: record.description ?? null,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  return {
    items,
    legacyToWorkItemId,
  };
}
