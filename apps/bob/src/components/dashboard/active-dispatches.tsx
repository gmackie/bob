"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";

import { useTRPC } from "~/trpc/react";

import type { badgeVariants } from "@gmacko/core/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: "slate",
  dispatching: "blue",
  running: "blue",
  completed: "emerald",
  failed: "rose",
};

export function ActiveDispatches() {
  const trpc = useTRPC();

  const { data: batches, isLoading } = useQuery(
    trpc.dispatch.listBatches.queryOptions(
      { limit: 5 },
      { refetchInterval: 10_000 },
    ),
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-sm font-semibold text-foreground">
        Dispatches
      </h3>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : !batches?.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No dispatches yet.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {(batches as any[]).map((batch) => (
            <Link
              key={batch.id}
              href={`/planning/dispatch/${batch.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
            >
              <Badge
                variant={STATUS_VARIANT[batch.status] ?? "slate"}
                className="text-[9px] px-1.5"
              >
                {batch.status}
              </Badge>
              <span className="flex-1 text-xs tabular-nums text-muted-foreground">
                {batch.completedTasks}/{batch.totalTasks}
              </span>
              {batch.failedTasks > 0 && (
                <span className="text-[10px] text-rose-400">
                  {batch.failedTasks} failed
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
