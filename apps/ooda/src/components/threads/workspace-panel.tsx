"use client";

import { useState } from "react";
import { useTRPC } from "~/trpc/react";
import { useQuery } from "@tanstack/react-query";

type NoteKind = "note" | "hypothesis" | "action" | "reflection" | "observation";

interface WorkspaceEntry {
  id: string;
  kind: string;
  title: string;
  content: string;
  provenanceRef?: string;
  promotedAt: string;
}

type FilterValue = "all" | NoteKind;

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Notes", value: "note" },
  { label: "Hypotheses", value: "hypothesis" },
  { label: "Actions", value: "action" },
];

const KIND_COLORS: Record<string, string> = {
  note: "bg-[#D4A04A]/20 text-[#D4A04A]",
  observation: "bg-[#D4A04A]/20 text-[#D4A04A]",
  hypothesis: "bg-blue-500/20 text-blue-400",
  action: "bg-green-500/20 text-green-400",
  reflection: "bg-purple-500/20 text-purple-400",
};

interface WorkspacePanelProps {
  threadSlug: string;
}

export function WorkspacePanel({ threadSlug }: WorkspacePanelProps) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");
  const trpc = useTRPC();

  // `threads.listNotes` is `.output(z.any())` for OpenAPI, which degenerates
  // the client query type; cast to the promoted-note shape we render.
  const notesQuery = useQuery(
    trpc.threads.listNotes.queryOptions(
      { slug: threadSlug },
      { refetchInterval: 3000 },
    ),
  );
  const entries = (notesQuery.data ?? []) as unknown as WorkspaceEntry[];

  const filtered =
    activeFilter === "all"
      ? entries
      : entries.filter((e: WorkspaceEntry) => e.kind === activeFilter);

  return (
    <div data-testid="workspace-panel" className="flex h-full flex-col">
      {/* Header with filter chips */}
      <div className="border-b border-[#2A2A2F] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[#E8E4DF]">Workspace</span>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setActiveFilter(f.value)}
                className={`rounded-[3px] px-2 py-1.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#D4A04A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] ${
                  activeFilter === f.value
                    ? "bg-[#D4A04A]/20 text-[#D4A04A]"
                    : "text-[#8A8580] hover:bg-[#1A1A1E] hover:text-[#E8E4DF]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Entries stream */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-[#8A8580]">No promoted notes yet.</p>
            <p className="mt-1 text-xs text-[#5A5855]">
              Promote results from chat to build your workspace.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry: WorkspaceEntry) => (
              <div
                key={entry.id}
                className="rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium uppercase ${KIND_COLORS[entry.kind] ?? "bg-[#2A2A2F] text-[#8A8580]"}`}
                  >
                    {entry.kind}
                  </span>
                  <span className="text-sm font-medium text-[#E8E4DF]">
                    {entry.title}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#8A8580]">{entry.content}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-[#5A5855]">
                    {entry.promotedAt}
                  </span>
                  {entry.provenanceRef && (
                    <span className="font-mono text-[10px] text-[#5A5855]">
                      {entry.provenanceRef}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
