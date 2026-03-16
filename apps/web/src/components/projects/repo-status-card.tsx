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
    <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-medium text-white">
            {repository.name}
          </div>
          <div className="mt-1 text-sm text-white/55">{repository.path}</div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
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
            className="rounded-full border border-sky-400/40 px-4 py-2 text-sm text-sky-200 transition hover:border-sky-300 hover:text-white"
          >
            Open repository
          </Link>
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
            onClick={onRefreshMain}
            disabled={disabled}
          >
            Refresh main
          </button>
          <button
            type="button"
            className="rounded-full border border-rose-400/35 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300 hover:text-white"
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
