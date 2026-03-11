"use client";

import type { Repository } from "~/lib/legacy/types";

interface RepositoryDashboardPanelProps {
  repository: Repository;
  isLeftPanelCollapsed: boolean;
  onSelectWorktree: (worktreeId: string) => void;
}

export function RepositoryDashboardPanel({
  repository,
  isLeftPanelCollapsed,
  onSelectWorktree,
}: RepositoryDashboardPanelProps) {
  return (
    <main
      className={`dash-repoDashboardPanel ${
        isLeftPanelCollapsed ? "is-collapsed" : "is-expanded"
      }`}
    >
      <header className="dash-repoDashboardHeader">
        <div>
          <div className="dash-repoDashboardTag">Repository dashboard</div>
          <h1 className="dash-repoDashboardTitle">{repository.name}</h1>
          <p className="dash-repoDashboardPath" title={repository.path}>
            {repository.path}
          </p>
        </div>
        <div className="dash-repoDashboardCounter">
          {repository.worktrees.length} worktree
          {repository.worktrees.length === 1 ? "" : "s"}
        </div>
      </header>

      <section className="dash-repoDashboardContent">
        <div className="dash-repoStatsGrid">
          <article className="dash-repoStatCard">
            <h3 className="dash-repoStatLabel">Main branch</h3>
            <p className="dash-repoStatValue">{repository.mainBranch}</p>
          </article>

          <article className="dash-repoStatCard">
            <h3 className="dash-repoStatLabel">Current branch</h3>
            <p className="dash-repoStatValue">{repository.branch}</p>
          </article>

          <article className="dash-repoStatCard">
            <h3 className="dash-repoStatLabel">Repository</h3>
            <p className="dash-repoStatMono">{repository.id}</p>
          </article>
        </div>

        <div className="dash-projectRow">
          <div className="dash-projectRowHeader">
            <div className="dash-projectRowTitle">Active worktrees</div>
            <div className="dash-projectRowMeta">
              {repository.worktrees.length}
            </div>
          </div>

          <div className="dash-projectRowBody">
            {repository.worktrees.length === 0 ? (
              <div className="dash-repoDashboardEmpty">
                <div className="dash-repoDashboardEmptyGlyph">🌳</div>
                <p className="dash-repoDashboardEmptyTitle">
                  No worktrees yet
                </p>
                <p className="dash-repoDashboardEmptyHint">
                  Create a worktree from the repository panel to get started
                </p>
              </div>
            ) : (
              <div className="dash-repoWorktreeRail">
                {repository.worktrees.map((worktree) => (
                  <article
                    key={worktree.id}
                    className="dash-repoWorktreeCard"
                  >
                    <div className="dash-repoWorktreeInfo">
                      <div className="dash-repoWorktreeBranch">
                        {worktree.branch.replace(/^refs\/heads\//, "")}
                      </div>
                      <div className="dash-repoWorktreePath">{worktree.path}</div>
                    </div>
                    <button
                      onClick={() => onSelectWorktree(worktree.id)}
                      className="dash-agentPanelAction is-success"
                      type="button"
                    >
                      Open
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
