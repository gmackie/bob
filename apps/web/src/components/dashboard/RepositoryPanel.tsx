"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useMemo, useState } from "react";

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
  const [branchName, setBranchName] = useState("");
  const [agentType, setAgentType] = useState<AgentType>("opencode");
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
        headers: {
          "Content-Type": "application/json",
        },
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

  const handleCreateWorktree = async () => {
    if (!mappedRepository || !branchName.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const worktree = await api.createWorktree(
        mappedRepository.id,
        branchName.trim(),
      );
      await api.startInstance(worktree.id, agentType);
      setBranchName("");
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
          <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-medium text-white">
                  {mappedRepository.name}
                </div>
                <div className="mt-1 text-sm text-white/55">
                  {mappedRepository.path}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/45">
                  <span>Main: {mappedRepository.mainBranch}</span>
                  <span>Current: {mappedRepository.branch}</span>
                  <span>
                    Provider: {mappedRepository.remoteProvider ?? "unconfigured"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/repositories/${mappedRepository.id}`}
                  className="rounded-full border border-sky-400/40 px-4 py-2 text-sm text-sky-200 transition hover:border-sky-300 hover:text-white"
                >
                  Open repository
                </Link>
                <button
                  type="button"
                  className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
                  onClick={() => void handleRefreshMainBranch()}
                  disabled={submitting}
                >
                  Refresh main
                </button>
                <button
                  type="button"
                  className="rounded-full border border-rose-400/35 px-4 py-2 text-sm text-rose-200 transition hover:border-rose-300 hover:text-white"
                  onClick={() => void handleUnmapRepository()}
                  disabled={submitting}
                >
                  Unmap
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-white">
                  Create a worktree
                </div>
                <div className="mt-1 text-sm text-white/55">
                  Start an agent instance immediately after creating the branch.
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
              <input
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="feature/project-scoped-controls"
                className="rounded-2xl border border-white/10 bg-[#07101b] px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/50"
              />
              <select
                value={agentType}
                onChange={(event) => setAgentType(event.target.value as AgentType)}
                className="rounded-2xl border border-white/10 bg-[#07101b] px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/50"
              >
                <option value="opencode">OpenCode</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
                <option value="gemini">Gemini</option>
                <option value="kiro">Kiro</option>
                <option value="cursor-agent">Cursor Agent</option>
              </select>
              <button
                type="button"
                className="rounded-2xl bg-sky-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-500"
                onClick={() => void handleCreateWorktree()}
                disabled={submitting || branchName.trim().length === 0}
              >
                Create
              </button>
            </div>
          </div>

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
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-5">
          <div className="text-sm font-medium text-white">Map a repository</div>
          <p className="mt-2 text-sm text-white/60">
            Choose one of your connected repositories and attach it to this
            planning project.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <select
              value={selectedFullName}
              onChange={(event) => setSelectedFullName(event.target.value)}
              className="rounded-2xl border border-white/10 bg-[#07101b] px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400/50"
            >
              {repoOptions.length === 0 ? (
                <option value="">No connected repositories</option>
              ) : null}
              {repoOptions.map((option) => (
                <option key={option.fullName} value={option.fullName}>
                  {option.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-2xl bg-sky-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-500"
              onClick={() => void handleMapRepository()}
              disabled={submitting || !selectedOption}
            >
              Map repository
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
