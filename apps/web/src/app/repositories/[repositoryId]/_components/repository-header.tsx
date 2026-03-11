"use client";

import Link from "next/link";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  mainBranch: string;
  remoteUrl?: string | null;
  remoteProvider?: string | null;
  remoteOwner?: string | null;
  remoteName?: string | null;
}

interface RepositoryHeaderProps {
  repository: Repository;
}

export function RepositoryHeader({ repository }: RepositoryHeaderProps) {
  const hasRemote =
    repository.remoteProvider &&
    repository.remoteOwner &&
    repository.remoteName;

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "github":
        return "G";
      case "gitlab":
        return "L";
      case "gitea":
        return "T";
      default:
        return "?";
    }
  };

  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{repository.name}</h1>
          {hasRemote && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
              )}
            >
              <span className="font-mono">
                {getProviderIcon(repository.remoteProvider!)}
              </span>
              {repository.remoteOwner}/{repository.remoteName}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">{repository.path}</p>
        <div className="mt-2 flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Branch:</span>
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
              {repository.branch}
            </code>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-gray-400">Main:</span>
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
              {repository.mainBranch}
            </code>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {hasRemote && repository.remoteUrl && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={repository.remoteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on {repository.remoteProvider}
            </a>
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href="/chat">Open Chat</Link>
        </Button>
      </div>
    </div>
  );
}
