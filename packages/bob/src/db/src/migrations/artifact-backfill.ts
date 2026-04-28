export interface LegacyArtifactRecord {
  legacyId: string;
  workItemLegacyId: string;
  role: string;
  type: string;
  producerType: "bob" | "forgegraph" | "human" | "system";
  url: string;
  title?: string;
  summary?: string;
  createdAt: Date;
}

export interface BackfilledArtifactRecord {
  legacyId: string;
  workItemId: string;
  artifactRole: string;
  artifactType: string;
  producerType: "bob" | "forgegraph" | "human" | "system";
  url: string;
  title: string | null;
  summary: string | null;
  createdAt: Date;
  isCurrent: boolean;
}

export function buildArtifactBackfill(input: {
  legacyToWorkItemId: Record<string, string>;
  artifacts: LegacyArtifactRecord[];
}) {
  const latestByRole = new Map<string, string>();

  const sortedArtifacts = [...input.artifacts].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );

  for (const artifact of sortedArtifacts) {
    latestByRole.set(
      `${artifact.workItemLegacyId}:${artifact.role}`,
      artifact.legacyId,
    );
  }

  return sortedArtifacts
    .map<BackfilledArtifactRecord | null>((artifact) => {
      const workItemId = input.legacyToWorkItemId[artifact.workItemLegacyId];
      if (!workItemId) {
        return null;
      }

      return {
        legacyId: artifact.legacyId,
        workItemId,
        artifactRole: artifact.role,
        artifactType: artifact.type,
        producerType: artifact.producerType,
        url: artifact.url,
        title: artifact.title ?? null,
        summary: artifact.summary ?? null,
        createdAt: artifact.createdAt,
        isCurrent:
          latestByRole.get(`${artifact.workItemLegacyId}:${artifact.role}`) ===
          artifact.legacyId,
      };
    })
    .filter((artifact): artifact is BackfilledArtifactRecord => artifact !== null);
}
