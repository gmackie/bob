"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface TodayInboxProps {
  // ISO string so the server component can serialize across the RSC
  // boundary; we parse back to Date on the client.
  since: string;
}

type InboxItem = {
  id: string;
  sourceId: number;
  title: string | null;
  author: string | null;
  year: number | null;
  reasonMd: string | null;
  score: number | null;
  foundAt: Date;
  triage: "pending" | "saved" | "dismissed" | "promoted";
  standingInterestLabel: string | null;
};

export function TodayInbox({ since }: TodayInboxProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const sinceDate = new Date(since);
  const queryOptions = trpc.research.inboxVaultWide.queryOptions({
    triage: "pending",
    since: sinceDate,
    limit: 50,
  });
  const queryKey = queryOptions.queryKey;

  const inboxQuery = useQuery(queryOptions);

  const triageMutation = useMutation(
    trpc.research.inboxTriage.mutationOptions({
      onMutate: async ({ id }: { id: string }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<{ items: InboxItem[] }>(queryKey);
        if (previous) {
          queryClient.setQueryData<{ items: InboxItem[] }>(queryKey, {
            items: previous.items.filter((item) => item.id !== id),
          });
        }
        return { previous };
      },
      onError: (
        _err: unknown,
        _vars: { id: string },
        context: { previous?: { items: InboxItem[] } } | undefined,
      ) => {
        if (context?.previous) {
          queryClient.setQueryData(queryKey, context.previous);
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey });
      },
    }),
  );

  if (inboxQuery.isLoading) {
    return <div className="text-xs text-subtle">Loading today's inbox…</div>;
  }
  if (inboxQuery.isError) {
    return (
      <div className="text-xs text-red-400">Failed to load today's inbox.</div>
    );
  }
  const items = (inboxQuery.data?.items ?? []) as InboxItem[];
  if (items.length === 0) {
    return (
      <div className="text-xs text-subtle">
        No new findings yet today.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-[4px] border border-border bg-background p-3"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {item.title ?? "(untitled)"}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-subtle">
                {item.author ?? "unknown"}
                {item.year !== null ? ` · ${item.year}` : ""}
                {item.standingInterestLabel
                  ? ` · ${item.standingInterestLabel}`
                  : ""}
              </div>
            </div>
            {item.score !== null && (
              <span className="rounded-[2px] bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                {item.score.toFixed(2)}
              </span>
            )}
          </div>
          {item.reasonMd && (
            <p className="mb-2 line-clamp-2 text-xs text-[#9A9590]">
              {item.reasonMd}
            </p>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() =>
                triageMutation.mutate({ id: item.id, action: "save" })
              }
              disabled={triageMutation.isPending}
              className="rounded-[3px] border border-border bg-card px-2 py-1 font-mono text-[10px] text-foreground hover:border-primary disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() =>
                triageMutation.mutate({ id: item.id, action: "dismiss" })
              }
              disabled={triageMutation.isPending}
              className="rounded-[3px] border border-border bg-card px-2 py-1 font-mono text-[10px] text-subtle hover:border-red-500 hover:text-red-400 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
