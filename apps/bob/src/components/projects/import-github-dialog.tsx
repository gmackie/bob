"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "@gmacko/core/ui/toast";
import { Button } from "@gmacko/core/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gmacko/core/ui/dialog";
import { Input } from "@gmacko/core/ui/input";

import { useTRPC } from "~/trpc/react";

interface ImportGitHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

interface RepoOption {
  fullName: string;
  preferred: {
    provider: string;
    instanceUrl: string;
    sshUrl: string;
    htmlUrl: string;
    defaultBranch: string;
    isPrivate: boolean;
  };
}

interface RepoApiResponse {
  repos: RepoOption[];
  connections: unknown[];
}

function deriveKey(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 6);
}

function repoShortName(fullName: string): string {
  const parts = fullName.split("/");
  return parts[parts.length - 1] ?? fullName;
}

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
];

export function ImportGitHubDialog({
  open,
  onOpenChange,
  workspaceId,
}: ImportGitHubDialogProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<
    Map<string, { name: string; key: string }>
  >(new Map());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const { data, isLoading, error } = useQuery<RepoApiResponse>({
    queryKey: ["repo-options"],
    queryFn: () => fetch("/api/planning/repo-options").then((r) => r.json()),
    enabled: open,
  });

  const repos = data?.repos ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return repos;
    const q = search.toLowerCase();
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, search]);

  const allFilteredSelected = useMemo(() => {
    return filtered.length > 0 && filtered.every((r) => selected.has(r.fullName));
  }, [filtered, selected]);

  const toggleRepo = useCallback(
    (repo: RepoOption) => {
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(repo.fullName)) {
          next.delete(repo.fullName);
        } else {
          const shortName = repoShortName(repo.fullName);
          next.set(repo.fullName, {
            name: shortName,
            key: deriveKey(shortName),
          });
        }
        return next;
      });
    },
    [],
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Map(prev);
        for (const r of filtered) {
          next.delete(r.fullName);
        }
        return next;
      } else {
        const next = new Map(prev);
        for (const r of filtered) {
          if (!next.has(r.fullName)) {
            const shortName = repoShortName(r.fullName);
            next.set(r.fullName, {
              name: shortName,
              key: deriveKey(shortName),
            });
          }
        }
        return next;
      }
    });
  }, [allFilteredSelected, filtered]);

  const updateName = useCallback((fullName: string, newName: string) => {
    setSelected((prev) => {
      const entry = prev.get(fullName);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(fullName, {
        name: newName,
        key: entry.key === deriveKey(entry.name) ? deriveKey(newName) : entry.key,
      });
      return next;
    });
  }, []);

  const updateKey = useCallback((fullName: string, newKey: string) => {
    setSelected((prev) => {
      const entry = prev.get(fullName);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(fullName, { ...entry, key: newKey.toUpperCase() });
      return next;
    });
  }, []);

  const createProject = useMutation(
    trpc.project.create.mutationOptions({}),
  );

  const addRepo = useMutation(
    trpc.repository.addFromProvider.mutationOptions({}),
  );

  async function handleImport() {
    const entries = Array.from(selected.entries());
    if (entries.length === 0) return;

    setImporting(true);
    setProgress({ done: 0, total: entries.length });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < entries.length; i++) {
      const [fullName, { name, key }] = entries[i]!;
      const repo = repos.find((r) => r.fullName === fullName);
      try {
        const project = await createProject.mutateAsync({
          workspaceId,
          name: name.trim() || repoShortName(fullName),
          key: (key.trim() || deriveKey(name)).toUpperCase(),
          description: repo
            ? `Imported from ${repo.preferred.htmlUrl}`
            : `Imported from ${fullName}`,
          color: COLORS[i % COLORS.length],
        });

        // Also register the repository so agent sessions can use it
        if (repo) {
          void addRepo.mutateAsync({
            fullName,
            cloneUrl: repo.preferred.sshUrl || repo.preferred.htmlUrl + ".git",
            htmlUrl: repo.preferred.htmlUrl,
            defaultBranch: repo.preferred.defaultBranch || "main",
            provider: repo.preferred.provider,
            instanceUrl: repo.preferred.instanceUrl,
            projectId: project?.id,
          }).catch((err) => {
            console.warn(`Failed to register repo ${fullName}:`, err);
          });
        }

        successCount++;
      } catch (err) {
        errorCount++;
        console.error(`Failed to import ${fullName}:`, err);
      }
      setProgress({ done: i + 1, total: entries.length });
    }

    setImporting(false);

    if (successCount > 0) {
      toast(
        `Imported ${successCount} project${successCount !== 1 ? "s" : ""}${errorCount > 0 ? ` (${errorCount} failed)` : ""}`,
      );
      void queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey() });
      router.refresh();
      onOpenChange(false);
      setSelected(new Map());
      setSearch("");
    } else if (errorCount > 0) {
      toast("All imports failed. Check that project keys are unique.", {
        style: { background: "#1a0000", borderColor: "#f43f5e40" },
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from GitHub</DialogTitle>
          <DialogDescription>
            Select repositories to import as projects. You can customize the
            project name and key for each.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="mt-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search repositories..."
          />
        </div>

        {/* Select all toggle */}
        {!isLoading && repos.length > 0 && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {allFilteredSelected ? "Deselect All" : "Select All"}
            </button>
            <span className="text-sm text-muted-foreground">
              {selected.size} selected
            </span>
          </div>
        )}

        {/* Repo list */}
        <div className="max-h-[400px] overflow-y-auto rounded-lg border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-12">
              <svg
                className="h-4 w-4 animate-spin text-muted-foreground"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-sm text-muted-foreground">
                Loading repositories...
              </span>
            </div>
          ) : error ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Failed to load repositories. Please try again.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {repos.length === 0
                ? "No GitHub repositories found. Connect GitHub in Settings."
                : "No repositories match your search."}
            </div>
          ) : (
            filtered.map((repo) => {
              const isSelected = selected.has(repo.fullName);
              const entry = selected.get(repo.fullName);

              return (
                <div
                  key={repo.fullName}
                  className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/50 transition-colors"
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRepo(repo)}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                  />

                  {/* Repo name */}
                  <span className="shrink-0 min-w-[140px] text-sm text-muted-foreground truncate">
                    {repo.fullName}
                  </span>

                  {/* Private/public badge */}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      repo.preferred.isPrivate
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-emerald-500/10 text-emerald-500"
                    }`}
                  >
                    {repo.preferred.isPrivate ? "Private" : "Public"}
                  </span>

                  {/* Editable fields (shown when selected) */}
                  {isSelected && entry ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input
                        value={entry.name}
                        onChange={(e) =>
                          updateName(repo.fullName, e.target.value)
                        }
                        placeholder="Project name"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={entry.key}
                        onChange={(e) =>
                          updateKey(repo.fullName, e.target.value)
                        }
                        placeholder="KEY"
                        maxLength={6}
                        className="h-8 w-20 text-sm font-mono"
                      />
                    </div>
                  ) : (
                    <div className="flex-1" />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <DialogFooter>
          {importing && (
            <span className="mr-auto text-sm text-muted-foreground">
              Importing {progress.done}/{progress.total}...
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
          >
            {importing
              ? `Importing ${progress.done}/${progress.total}...`
              : `Import ${selected.size} project${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
