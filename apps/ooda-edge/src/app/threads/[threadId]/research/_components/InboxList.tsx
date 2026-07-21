"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface InboxListProps {
  threadId: string;
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
  standingInterestLabel: string;
};

// Default KB slug when the user promotes without picking one.
const DEFAULT_KB_SLUG = "unassigned";

export function InboxList({ threadId }: InboxListProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const queryOptions = trpc.research.inboxByThread.queryOptions({
    threadId,
    triage: "pending",
  });
  const queryKey = queryOptions.queryKey;

  const inboxQuery = useQuery(queryOptions);

  // Optimistic remove helper used by save + dismiss + promote.
  const optimisticRemove = {
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
  };

  const triageMutation = useMutation(
    trpc.research.inboxTriage.mutationOptions(optimisticRemove),
  );

  const promoteMutation = useMutation(
    trpc.research.kbPromoteRequest.mutationOptions({
      onMutate: async (vars: { sourceIds: number[] }) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<{ items: InboxItem[] }>(queryKey);
        if (previous) {
          queryClient.setQueryData<{ items: InboxItem[] }>(queryKey, {
            items: previous.items.filter(
              (item) => !vars.sourceIds.includes(item.sourceId),
            ),
          });
        }
        return { previous };
      },
      onError: (
        _err: unknown,
        _vars: { sourceIds: number[] },
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
    return <div className="p-3 text-xs text-[#5A5855]">Loading inbox...</div>;
  }
  if (inboxQuery.isError) {
    return (
      <div className="p-3 text-xs text-red-400">
        Failed to load inbox.
      </div>
    );
  }
  // `research.inboxByThread` declares `.output(z.any())` (required by
  // trpc-to-openapi), which degenerates the client-inferred type.
  const items =
    (inboxQuery.data as { items: InboxItem[] } | undefined)?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="p-3 text-xs text-[#5A5855]">No pending findings.</div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <InboxRow
          key={item.id}
          item={item as InboxItem}
          onSave={() =>
            triageMutation.mutate({ id: item.id, action: "save" })
          }
          onDismiss={() =>
            triageMutation.mutate({ id: item.id, action: "dismiss" })
          }
          onPromote={(noteMd) => {
            promoteMutation.mutate({
              threadId,
              sourceIds: [item.sourceId],
              kbSlug: DEFAULT_KB_SLUG,
              noteMd,
              createdByThreadId: threadId,
            });
            triageMutation.mutate({ id: item.id, action: "promote" });
          }}
          disabled={triageMutation.isPending || promoteMutation.isPending}
        />
      ))}
    </div>
  );
}

interface InboxRowProps {
  item: InboxItem;
  onSave: () => void;
  onDismiss: () => void;
  onPromote: (noteMd: string) => void;
  disabled: boolean;
}

function InboxRow({ item, onSave, onDismiss, onPromote, disabled }: InboxRowProps) {
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="rounded-[4px] border border-[#2A2A2F] bg-[#1A1A1E] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[#E8E4DF]">
            {item.title ?? "(untitled)"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-[#5A5855]">
            {item.author ?? "unknown"}
            {item.year !== null ? ` · ${item.year}` : ""}
            {item.standingInterestLabel
              ? ` · ${item.standingInterestLabel}`
              : ""}
          </div>
        </div>
        {item.score !== null && (
          <span className="rounded-[2px] bg-[#D4A04A]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#D4A04A]">
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
          onClick={onSave}
          disabled={disabled}
          className="rounded-[3px] border border-[#2A2A2F] bg-[#1A1A1E] px-2 py-1 font-mono text-[10px] text-[#E8E4DF] hover:border-[#D4A04A] disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={disabled}
          className="rounded-[3px] border border-[#2A2A2F] bg-[#1A1A1E] px-2 py-1 font-mono text-[10px] text-[#5A5855] hover:border-red-500 hover:text-red-400 disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => setPromoteOpen((v) => !v)}
          disabled={disabled}
          className="rounded-[3px] border border-[#2A2A2F] bg-[#D4A04A]/10 px-2 py-1 font-mono text-[10px] text-[#D4A04A] hover:bg-[#D4A04A]/20 disabled:opacity-50"
        >
          Promote
        </button>
      </div>
      {promoteOpen && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Promotion note (markdown)..."
            rows={3}
            className="w-full rounded-[3px] border border-[#2A2A2F] bg-[#111113] px-2 py-1.5 text-xs text-[#E8E4DF] placeholder-[#5A5855] outline-none focus:border-[#D4A04A]"
          />
          <button
            type="button"
            disabled={!note.trim() || disabled}
            onClick={() => {
              onPromote(note.trim());
              setPromoteOpen(false);
              setNote("");
            }}
            className="rounded-[3px] bg-[#D4A04A] px-3 py-1 font-mono text-[10px] font-medium text-[#111113] hover:opacity-90 disabled:opacity-50"
          >
            Create draft
          </button>
        </div>
      )}
    </div>
  );
}
