"use client";

export interface PrChangedFilesProps {
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  url: string;
  commits: Array<{
    sha: string;
    message: string;
    authorName: string | null;
    committedAt: Date;
    isBobCommit: boolean;
  }>;
}

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function PrChangedFiles({
  additions,
  deletions,
  changedFiles,
  url,
  commits,
}: PrChangedFilesProps) {
  const hasStats =
    additions !== null || deletions !== null || changedFiles !== null;

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="font-display text-sm font-semibold text-foreground">
        Changes
      </h2>

      {hasStats && (
        <div className="mt-3 flex items-center gap-4 text-sm">
          {changedFiles !== null && (
            <span className="text-muted-foreground">
              {changedFiles} file{changedFiles !== 1 ? "s" : ""}
            </span>
          )}
          {additions !== null && (
            <span className="text-emerald-600 dark:text-emerald-400">
              +{additions}
            </span>
          )}
          {deletions !== null && (
            <span className="text-red-600 dark:text-red-400">
              -{deletions}
            </span>
          )}
        </div>
      )}

      {/* Commits list */}
      {commits.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Commits ({commits.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {commits.map((commit) => (
              <li
                key={commit.sha}
                className="flex items-baseline gap-2 text-sm"
              >
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {commit.sha.slice(0, 7)}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {commit.message.split("\n")[0]}
                  {commit.isBobCommit && (
                    <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                      bob
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {commit.authorName && `${commit.authorName} · `}
                  {timeAgo(commit.committedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <a
          href={url.includes("/files") ? url : `${url}/files`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          View full diff on remote
        </a>
      </div>
    </div>
  );
}
