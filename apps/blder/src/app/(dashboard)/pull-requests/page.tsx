"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { PrList, PrListHeader } from "~/components/pull-requests/pr-list";
import { useTRPC } from "~/trpc/react";

type StatusFilter = "open" | "merged" | "closed" | "draft" | undefined;

export default function PullRequestsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(undefined);

  const trpc = useTRPC();

  // Fetch all to get counts for the header pills
  const { data: allPrs } = useQuery(
    trpc.pullRequest.list.queryOptions({ limit: 100 }, { staleTime: 15_000 }),
  );

  const allCount = allPrs?.length ?? 0;
  const openCount =
    allPrs?.filter((pr) => pr.status === "open" || pr.status === "draft")
      .length ?? 0;
  const mergedCount =
    allPrs?.filter((pr) => pr.status === "merged").length ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Pull Requests" }]} className="mb-4" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-foreground text-3xl font-semibold">
            Pull Requests
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Track pull requests created by BizPulse and synced from your
            repositories.
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <PrListHeader
          allCount={allCount}
          openCount={openCount}
          mergedCount={mergedCount}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />
        <span className="text-muted-foreground text-xs">{allCount} total</span>
      </div>

      <div className="mt-4">
        <PrList statusFilter={statusFilter} />
      </div>
    </main>
  );
}
