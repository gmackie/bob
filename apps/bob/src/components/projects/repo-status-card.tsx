"use client";

import Link from "next/link";

interface RepoStatusCardProps {
  repository: {
    id: string;
    name: string;
    path: string;
    mainBranch: string;
    branch: string;
    remoteProvider?: string | null;
  };
  onRefreshMain: () => void;
  onUnmap: () => void;
  disabled?: boolean;
}

export function RepoStatusCard({
  repository,
  onRefreshMain,
  onUnmap,
  disabled,
}: RepoStatusCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-secondary p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">
            {repository.name}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{repository.path}</div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Main: {repository.mainBranch}</span>
            <span>Current: {repository.branch}</span>
            <span>
              Provider: {repository.remoteProvider ?? "unconfigured"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/repositories/${repository.id}`}
            className="rounded-full border border-sky-400/40 px-4 py-2 text-sm text-sky-200 transition hover:border-sky-300 hover:text-foreground"
          >
            Open repository
          </Link>
          <button
            type="button"
            className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
            onClick={onRefreshMain}
            disabled={disabled}
          >
            Refresh main
          </button>
          <button
            type="button"
            className="rounded-full border border-rose-400/35 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300 hover:text-foreground"
            onClick={onUnmap}
            disabled={disabled}
          >
            Unmap
          </button>
        </div>
      </div>
    </div>
  );
}
