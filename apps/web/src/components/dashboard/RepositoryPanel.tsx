"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useMemo, useState } from "react";

import { AgentLauncher } from "~/components/projects/agent-launcher";
import { RepoSelector } from "~/components/projects/repo-selector";
import { RepoStatusCard } from "~/components/projects/repo-status-card";
import { api } from "~/lib/rest/api";

type AgentType =
  | "claude"
  | "codex"
  | "cursor-agent"
  | "gemini"
  | "kiro"
  | "opencode";

type RepositoryRecord = Awaited<ReturnType<typeof api.getRepositories>>[number] & {
  planningProjectId?: string | null;
  remoteProvider?: string | null;
  remoteUrl?: string | null;
};

type InstanceRecord = Awaited<ReturnType<typeof api.getInstances>>[number];

type RepoOptionsResponse = {
  repos: Array<{
    fullName: string;
    preferred: {
      provider: "gitea" | "github";
      instanceUrl: string | null;
      defaultBranch: string;
    };
  }>;
};

interface RepositoryPanelProps {
  projectId: string;
}

export function RepositoryPanel({ projectId }: RepositoryPanelProps) {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [repoOptions, setRepoOptions] = useState<RepoOptionsResponse["repos"]>(
    [],
  );
  const [selectedFullName, setSelectedFullName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextRepositories, nextInstances, repoOptionsResponse] =
        await Promise.all([
          api.getRepositories() as Promise<RepositoryRecord[]>,
          api.getInstances(),
          fetch("/api/planning/repo-options", { cache: "no-store" }).then(
            async (response) => {
              if (!response.ok) {
                throw new Error(`Failed to load repo options (${response.status})`);
              }
              return (await response.json()) as RepoOptionsResponse;
            },
          ),
        ]);

      setRepositories(nextRepositories);
      setInstances(nextInstances);
      setRepoOptions(repoOptionsResponse.repos);
      if (!selectedFullName && repoOptionsResponse.repos[0]?.fullName) {
        setSelectedFullName(repoOptionsResponse.repos[0].fullName);
      }
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to load repository controls",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const mappedRepository = useMemo(
    () =>
      repositories.find((repository) => repository.planningProjectId === projectId) ??
      null,
    [projectId, repositories],
  );

  const mappedInstances = useMemo(() => {
    if (!mappedRepository) return [];
    return instances.filter(
      (instance) => instance.repositoryId === mappedRepository.id,
    );
  }, [instances, mappedRepository]);

  const selectedOption = repoOptions.find(
    (option) => option.fullName === selectedFullName,
  );

  const handleMapRepository = async () => {
    if (!selectedOption) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/planning/projects/${projectId}/repo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedOption.preferred.provider,
          fullName: selectedOption.fullName,
          instanceUrl: selectedOption.preferred.instanceUrl,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Failed to map repository");
      }
      await refresh();
    } catch (mapError) {
      setError(
        mapError instanceof Error ? mapError.message : "Failed to map repository",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnmapRepository = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/planning/projects/${projectId}/repo`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Failed to unmap repository");
      }
      await refresh();
    } catch (unmapError) {
      setError(
        unmapError instanceof Error
          ? unmapError.message
          : "Failed to unmap repository",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshMainBranch = async () => {
    if (!mappedRepository) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.refreshMainBranch(mappedRepository.id);
      await refresh();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to refresh the main branch",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWorktree = async (branchName: string, agentType: AgentType) => {
    if (!mappedRepository) return;
    setSubmitting(true);
    setError(null);
    try {
      const worktree = await api.createWorktree(mappedRepository.id, branchName);
      await api.startInstance(worktree.id, agentType);
      await refresh();
    } catch (worktreeError) {
      setError(
        worktreeError instanceof Error
          ? worktreeError.message
          : "Failed to create the worktree",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-[#0d1524] p-6 text-white">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-white/35">
            Execution
          </div>
          <h2 className="mt-2 text-2xl font-semibold">Repository controls</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Map a repository to this project, create worktrees, and jump into the
            execution surfaces without reopening the legacy dashboard.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
          onClick={() => void refresh()}
          disabled={loading || submitting}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 px-4 py-6 text-sm text-white/55">
          Loading repository controls…
        </div>
      ) : mappedRepository ? (
        <div className="mt-6 space-y-6">
          <RepoStatusCard
            repository={mappedRepository}
            onRefreshMain={() => void handleRefreshMainBranch()}
            onUnmap={() => void handleUnmapRepository()}
            disabled={submitting}
          />

          <AgentLauncher
            onLaunch={(branch, agent) =>
              void handleCreateWorktree(branch, agent as AgentType)
            }
            disabled={submitting}
          />

          {/* Worktrees list */}
          <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-white">Worktrees</div>
              <div className="text-sm text-white/45">
                {mappedRepository.worktrees.length} active
              </div>
            </div>

            {mappedRepository.worktrees.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-white/15 px-4 py-6 text-sm text-white/55">
                No worktrees yet for this project repository.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {mappedRepository.worktrees.map((worktree) => {
                  const instance = mappedInstances.find(
                    (candidate) => candidate.worktreeId === worktree.id,
                  );

                  return (
                    <div
                      key={worktree.id}
                      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#07101b] px-4 py-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <div className="text-sm font-medium text-white">
                          {worktree.branch.replace(/^refs\/heads\//, "")}
                        </div>
                        <div className="mt-1 text-sm text-white/55">
                          {worktree.path}
                        </div>
                        <div className="mt-2 text-xs text-white/40">
                          Instance: {instance?.status ?? "not started"}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Link
                          href={`/repositories/${mappedRepository.id}`}
                          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <RepoSelector
            options={repoOptions}
            selectedFullName={selectedFullName}
            onSelect={setSelectedFullName}
            onMap={() => void handleMapRepository()}
            disabled={submitting}
          />
        </div>
      )}
    </section>
  );
}
