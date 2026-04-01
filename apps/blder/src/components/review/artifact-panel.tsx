// apps/web/src/components/review/artifact-panel.tsx
"use client";

import { cn } from "@bob/ui";

export interface ArtifactItem {
  id: string;
  artifactType: string;
  artifactRole: string;
  title: string | null;
  url: string | null;
  producerType: string;
  createdAt: Date | string;
}

interface ArtifactPanelProps {
  artifacts: ArtifactItem[];
}

const TYPE_ICON: Record<string, string> = {
  pr: "\uD83D\uDCCB",
  verification: "\uD83D\uDD12",
  build: "\uD83C\uDFD7",
  test_report: "\u2705",
  doc: "\uD83D\uDCC4",
  deliverable: "\uD83D\uDE80",
  planning_doc: "\uD83D\uDCDD",
  code_review: "\uD83D\uDCCB",
  other: "\uD83D\uDCCE",
};

const TYPE_BADGE_COLOR: Record<string, string> = {
  pr: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  build: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  test_report: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  code_review: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  verification: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  deliverable: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

function formatTimeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ArtifactPanel({ artifacts }: ArtifactPanelProps) {
  if (artifacts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No artifacts attached.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-display text-sm font-semibold text-foreground">Artifacts</h3>
        <span className="text-xs text-muted-foreground">{artifacts.length} items</span>
      </div>
      <div className="divide-y divide-border">
        {artifacts.map((artifact) => {
          const icon = TYPE_ICON[artifact.artifactType] ?? "\uD83D\uDCCE";
          const badgeColor = TYPE_BADGE_COLOR[artifact.artifactType] ?? "bg-muted text-muted-foreground";
          const isLink = !!artifact.url;

          const content = (
            <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {artifact.title ?? artifact.artifactRole}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", badgeColor)}>
                    {artifact.artifactType.replace(/_/g, " ")}
                  </span>
                  <span>{artifact.producerType} · {formatTimeAgo(artifact.createdAt)}</span>
                </div>
              </div>
            </div>
          );

          return isLink ? (
            <a key={artifact.id} href={artifact.url!} target="_blank" rel="noreferrer" className="block">
              {content}
            </a>
          ) : (
            <div key={artifact.id} className="cursor-default">{content}</div>
          );
        })}
      </div>
    </div>
  );
}
