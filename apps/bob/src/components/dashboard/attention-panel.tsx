"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

type AttentionCategory = "failed" | "review" | "approve";

interface AttentionItem {
  id: string;
  category: AttentionCategory;
  title: string;
  description: string;
  href: string;
}

const categoryConfig: Record<
  AttentionCategory,
  { label: string; dotClass: string; icon: string }
> = {
  failed: { label: "Failed", dotClass: "bg-rose-500", icon: "!" },
  review: { label: "Review", dotClass: "bg-amber-500", icon: "?" },
  approve: { label: "Approve", dotClass: "bg-blue-500", icon: ">" },
};

export function AttentionPanel() {
  const trpc = useTRPC();

  const { data: openPrs } = useQuery({
    ...trpc.pullRequest.list.queryOptions({ status: "open", limit: 20 }),
    staleTime: 30_000,
  });

  const { data: allRuns } = useQuery({
    ...trpc.agentRun.listAll.queryOptions({ limit: 50 }),
    staleTime: 15_000,
  });

  const items: AttentionItem[] = [];

  if (allRuns) {
    // Blocked runs are the "needs you" state — paused awaiting a human
    // decision (permission request / re-auth). Surface them first.
    const blockedRuns = (allRuns as any[]).filter(
      (r) => r.status === "blocked",
    );
    for (const run of blockedRuns) {
      const title = run.session?.title ?? run.workItemId ?? "Untitled run";
      items.push({
        id: `run-${run.id}`,
        category: "approve",
        title: typeof title === "string" && title.length > 60
          ? title.slice(0, 60) + "..."
          : title,
        description: `${run.agentType} · ${run.status}`,
        href: `/runs/${run.id}`,
      });
    }

    const failedRuns = (allRuns as any[]).filter(
      (r) => r.status === "failed" || r.status === "interrupted",
    );
    for (const run of failedRuns) {
      const title = run.session?.title ?? run.workItemId ?? "Untitled run";
      items.push({
        id: `run-${run.id}`,
        category: "failed",
        title: typeof title === "string" && title.length > 60
          ? title.slice(0, 60) + "..."
          : title,
        description: `${run.agentType} · ${run.status}`,
        href: `/runs/${run.id}`,
      });
    }
  }

  if (openPrs) {
    for (const pr of openPrs) {
      items.push({
        id: `pr-${pr.id}`,
        category: "review",
        title: pr.title,
        description: `${pr.remoteOwner}/${pr.remoteName} #${pr.number}`,
        href: pr.url,
      });
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-sm font-semibold text-foreground">
        Needs Attention
      </h3>

      {items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 font-body text-sm text-muted-foreground">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-emerald-500"
          >
            <path
              d="M13.5 4.5L6 12L2.5 8.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          All clear — nothing needs attention
        </div>
      ) : (
        <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
          {items.map((item) => {
            const config = categoryConfig[item.category];

            return (
              <a
                key={item.id}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2.5 rounded-lg p-2 transition hover:bg-muted/40"
              >
                {/* Category dot */}
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${config.dotClass}`}
                  aria-hidden="true"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {config.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-foreground">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
