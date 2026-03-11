export interface BobSessionSummary {
  id: string;
  workflowStatus?: string | null;
}

export interface BobRunSummary {
  id: string;
  status: string;
  latestSummary?: string | null;
  externalSessionUrl?: string | null;
  reviewUrl?: string | null;
  claimedAt?: Date | string | null;
  completedAt?: Date | string | null;
  session?: BobSessionSummary | null;
}

export interface IssueArtifactSummary {
  id: string;
  artifactType: string;
  artifactRole: string;
  url: string;
  title?: string | null;
  summary?: string | null;
  isCurrent: boolean;
}

export interface ChildIssueArtifactGroup {
  issue: {
    id: string;
    identifier: string;
    title: string | null;
    status: string;
  };
  artifacts: IssueArtifactSummary[];
}
