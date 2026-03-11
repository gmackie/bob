"use client";

import { ExternalLink, FileText, FlaskConical, GitPullRequest, Hammer, Package } from "lucide-react";

import { cn } from "@linear-clone/ui/lib/utils";

import type { ChildIssueArtifactGroup, IssueArtifactSummary } from "./task-detail-types";

const artifactTypeLabels: Record<string, string> = {
  pr: "PR",
  verification: "Verification",
  build: "Build",
  test_report: "Test report",
  doc: "Doc",
  deliverable: "Deliverable",
  other: "Artifact",
};

function getArtifactIcon(artifactType: string) {
  switch (artifactType) {
    case "pr":
      return <GitPullRequest className="h-4 w-4" />;
    case "verification":
      return <FlaskConical className="h-4 w-4" />;
    case "build":
      return <Hammer className="h-4 w-4" />;
    case "test_report":
      return <Package className="h-4 w-4" />;
    case "doc":
    case "deliverable":
      return <FileText className="h-4 w-4" />;
    default:
      return <ExternalLink className="h-4 w-4" />;
  }
}

function getArtifactLabel(artifact: IssueArtifactSummary) {
  return artifact.title?.trim() || artifactTypeLabels[artifact.artifactType] || "Artifact";
}

function ArtifactLink({ artifact }: { artifact: IssueArtifactSummary }) {
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 hover:bg-muted/40"
    >
      <div className="mt-0.5 text-muted-foreground">{getArtifactIcon(artifact.artifactType)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{getArtifactLabel(artifact)}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {artifactTypeLabels[artifact.artifactType] || "Artifact"}
          </span>
        </div>
        {artifact.summary ? <p className="mt-1 text-xs text-muted-foreground">{artifact.summary}</p> : null}
      </div>
      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

export function IssueArtifactList({
  title,
  artifacts,
  childGroups,
}: {
  title: string;
  artifacts?: IssueArtifactSummary[];
  childGroups?: ChildIssueArtifactGroup[];
}) {
  if ((!artifacts || artifacts.length === 0) && (!childGroups || childGroups.length === 0)) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {artifacts && artifacts.length > 0 ? (
        <div className="space-y-2">
          {artifacts.map((artifact) => (
            <ArtifactLink key={artifact.id} artifact={artifact} />
          ))}
        </div>
      ) : null}
      {childGroups && childGroups.length > 0 ? (
        <div className="space-y-3">
          {childGroups.map((group) => (
            <section
              key={group.issue.id}
              className="rounded-xl border border-border/70 bg-muted/20 p-3"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-muted-foreground">{group.issue.identifier}</p>
                  <p className="truncate text-sm font-medium">{group.issue.title || "Untitled issue"}</p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    group.issue.status === "in_review" && "bg-amber-500/10 text-amber-700",
                    group.issue.status === "in_progress" && "bg-blue-500/10 text-blue-700",
                    group.issue.status === "blocked" && "bg-red-500/10 text-red-700",
                    !["in_review", "in_progress", "blocked"].includes(group.issue.status) &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  {group.issue.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="space-y-2">
                {group.artifacts.map((artifact) => (
                  <ArtifactLink key={artifact.id} artifact={artifact} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
