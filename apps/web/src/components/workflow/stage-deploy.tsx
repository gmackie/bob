"use client";

import { useState } from "react";

import { cn } from "@bob/ui";

interface Deployment {
  id: string;
  environment: string;
  status: string;
  deployedAt?: string;
}

interface StageDeployProps {
  workItemId: string;
  workItem: {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    identifier: string;
  };
  isCurrentStage: boolean;
  isCompleted: boolean;
  deployments: Deployment[];
}

const DEPLOY_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted-foreground/15 text-muted-foreground",
  building: "bg-primary/15 text-primary",
  deploying: "bg-blue-500/15 text-blue-500",
  healthy: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-rose-500/15 text-rose-500",
  rolled_back: "bg-rose-500/15 text-rose-500",
};

const ENV_ORDER = ["staging", "production"];

export function StageDeploy({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
  deployments,
}: StageDeployProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;

  // Sort deployments by environment order
  const sortedDeployments = [...deployments].sort((a, b) => {
    const aIdx = ENV_ORDER.indexOf(a.environment);
    const bIdx = ENV_ORDER.indexOf(b.environment);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const stagingHealthy = deployments.some(
    (d) => d.environment === "staging" && d.status === "healthy",
  );
  const productionPending =
    !deployments.some(
      (d) =>
        d.environment === "production" &&
        (d.status === "healthy" || d.status === "deploying"),
    ) && stagingHealthy;

  return (
    <section
      id="stage-deploy"
      className="rounded-3xl border border-border bg-card p-6"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => isCompleted && setCollapsed((c) => !c)}
        className={cn(
          "flex w-full items-center gap-3",
          isCompleted && "cursor-pointer",
        )}
      >
        <h2 className="font-display text-lg font-semibold text-foreground">
          Deploy
        </h2>

        {isCompleted && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 6L5 8.5L9.5 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {isCompleted && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              "ml-auto text-muted-foreground transition-transform",
              isCollapsed && "-rotate-90",
            )}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="mt-4 space-y-3">
          <a
            href={`/work-items/${workItemId}/review`}
            className="flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            View Deploy Status →
          </a>
          {sortedDeployments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No deployments yet.
            </div>
          ) : (
            <>
              {/* Gate progression bar */}
              <div className="flex items-center gap-2">
                {sortedDeployments.map((deployment, idx) => (
                  <div key={deployment.id} className="flex flex-1 items-center">
                    <div
                      className={cn(
                        "flex-1 rounded-full py-1 text-center text-xs font-medium",
                        deployment.status === "healthy"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : deployment.status === "deploying" ||
                              deployment.status === "building"
                            ? "bg-primary/15 text-primary"
                            : deployment.status === "failed" ||
                                deployment.status === "rolled_back"
                              ? "bg-rose-500/15 text-rose-500"
                              : "bg-muted-foreground/10 text-muted-foreground",
                      )}
                    >
                      {deployment.environment}
                    </div>
                    {idx < sortedDeployments.length - 1 && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        className="mx-1 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      >
                        <path
                          d="M6 4L10 8L6 12"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                ))}
              </div>

              {/* Deployment cards */}
              <div className="grid gap-3 sm:grid-cols-2">
                {sortedDeployments.map((deployment) => (
                  <div
                    key={deployment.id}
                    className="rounded-2xl border border-border p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground capitalize">
                        {deployment.environment}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          DEPLOY_STATUS_STYLES[deployment.status] ??
                            DEPLOY_STATUS_STYLES.pending,
                        )}
                      >
                        {deployment.status.replace("_", " ")}
                      </span>
                    </div>
                    {deployment.deployedAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Deployed{" "}
                        {new Date(deployment.deployedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Production approval prompt */}
              {productionPending && isCurrentStage && (
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Staging is healthy. Ready to deploy to production.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
