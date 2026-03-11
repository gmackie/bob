"use client";

import { api } from "@/lib/trpc/client";

export function useIssueBobContext(
  issueId: string | null,
  childIssueCount: number,
) {
  const { data: bobRunHistory } = api.agent.listIssueRuns.useQuery(
    {
      issueId: issueId ?? "",
      limit: 10,
    },
    { enabled: Boolean(issueId) },
  );

  const { data: childArtifactGroups } =
    api.issueArtifact.listGroupedChildArtifacts.useQuery(
      {
        parentIssueId: issueId ?? "",
      },
      {
        enabled: Boolean(issueId) && childIssueCount > 0,
      },
    );

  return {
    bobRunHistory: bobRunHistory ?? [],
    childArtifactGroups: childArtifactGroups ?? [],
  };
}
