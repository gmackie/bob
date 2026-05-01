"use client";

import { useState } from "react";

import { useTRPC } from "~/trpc/react";
import { useQuery, useMutation } from "@tanstack/react-query";

import { ChatPanel } from "./chat-panel";
import { WorkspacePanel } from "./workspace-panel";
import { ComparisonView } from "./comparison-view";

interface ThreadShellProps {
  thread: {
    id: string;
    title: string;
    slug: string;
    status: string;
    domainPackId?: string | null;
  };
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  archived: "bg-[#5A5855]",
  completed: "bg-blue-500",
};

interface ComparisonSession {
  id: string;
  adapterId: string;
}

export function ThreadShell({ thread }: ThreadShellProps) {
  const [showCompareBar, setShowCompareBar] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [adapterA, setAdapterA] = useState("");
  const [adapterB, setAdapterB] = useState("");
  const [comparisonSessions, setComparisonSessions] = useState<
    [ComparisonSession, ComparisonSession] | null
  >(null);

  const trpc = useTRPC();

  // Get available runners
  const runnersQuery = useQuery(trpc.runner.listDevices.queryOptions());
  const firstRunner = runnersQuery.data?.[0];

  // Get adapters for the first available runner
  const adaptersQuery = useQuery({
    ...trpc.runner.listAdapters.queryOptions({
      runnerId: firstRunner?.id ?? "",
    }),
    enabled: !!firstRunner?.id && showCompareBar,
  });

  const adapters = adaptersQuery.data ?? [];

  const sendPromptMutation = useMutation(
    trpc.runner.sendPrompt.mutationOptions(),
  );

  const handleRunComparison = () => {
    if (!adapterA || !adapterB || !firstRunner) return;

    // Send prompt twice with different adapters
    // We use a fixed comparison prompt for now; in practice the user would type one
    const prompt = "Compare adapters"; // placeholder — the user's last chat input would be better

    // Fire both mutations
    sendPromptMutation.mutate(
      {
        threadId: thread.id,
        runnerId: firstRunner.id,
        adapterId: adapterA,
        toolProfileId: "default",
        prompt,
      },
      {
        onSuccess: (sessionA) => {
          if (!sessionA) return;
          sendPromptMutation.mutate(
            {
              threadId: thread.id,
              runnerId: firstRunner.id,
              adapterId: adapterB,
              toolProfileId: "default",
              prompt,
            },
            {
              onSuccess: (sessionB) => {
                if (!sessionB) return;
                setComparisonSessions([
                  { id: sessionA.id, adapterId: adapterA },
                  { id: sessionB.id, adapterId: adapterB },
                ]);
              },
            },
          );
        },
      },
    );
  };

  const handleCloseComparison = () => {
    setComparisonSessions(null);
    setShowCompareBar(false);
    setAdapterA("");
    setAdapterB("");
  };

  return (
    <div data-testid="thread-shell" className="flex h-screen flex-col bg-[#111113]">
      {/* Header. `min-w-0` + `truncate` on the title lets it shrink /
          ellipsis under sibling flex items (status dot, badges, Compare
          button). Without the min-w-0 guard the title forces the flex
          container wider than the viewport on narrow widths. */}
      <header className="flex items-center gap-3 border-b border-[#2A2A2F] px-4 py-3">
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[thread.status] ?? "bg-[#5A5855]"}`}
          title={thread.status}
        />
        <h1 className="min-w-0 truncate font-serif text-lg text-[#E8E4DF]">
          {thread.title}
        </h1>
        {thread.domainPackId && (
          <span className="hidden shrink-0 rounded-[3px] bg-[#1A1A1E] px-2 py-0.5 font-mono text-xs text-[#8A8580] sm:inline">
            {thread.domainPackId}
          </span>
        )}
        <span className="ml-auto hidden shrink-0 rounded-[3px] bg-[#1A1A1E] px-2 py-0.5 text-xs text-[#5A5855] sm:inline">
          {thread.status}
        </span>
        <button
          onClick={() => setShowCompareBar((v) => !v)}
          className={`shrink-0 rounded-[3px] border px-3 py-1.5 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-[#D4A04A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113] ${
            showCompareBar || comparisonSessions
              ? "border-[#D4A04A] bg-[#D4A04A]/15 text-[#D4A04A]"
              : "border-[#2A2A2F] text-[#8A8580] hover:border-[#D4A04A] hover:text-[#D4A04A]"
          }`}
        >
          Compare
        </button>
      </header>

      {/* Comparison config bar. flex-wrap + gap-y so the Adapters:
          label, the two selects, vs, Run, and Cancel reflow onto
          multiple rows on narrow widths instead of clipping or causing
          horizontal scroll. */}
      {showCompareBar && !comparisonSessions && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#D4A04A]/40 bg-[#2E2A1A] px-4 py-2">
          <span className="font-mono text-xs text-[#D4A04A]">Adapters:</span>
          <select
            value={adapterA}
            onChange={(e) => setAdapterA(e.target.value)}
            className="rounded-[3px] border border-[#D4A04A]/30 bg-[#1A1A1E] px-2 py-1 font-mono text-xs text-[#E8E4DF] outline-none"
          >
            <option value="">Select A</option>
            {adapters.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="font-mono text-xs text-[#5A5855]">vs</span>
          <select
            value={adapterB}
            onChange={(e) => setAdapterB(e.target.value)}
            className="rounded-[3px] border border-[#D4A04A]/30 bg-[#1A1A1E] px-2 py-1 font-mono text-xs text-[#E8E4DF] outline-none"
          >
            <option value="">Select B</option>
            {adapters.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            onClick={handleRunComparison}
            disabled={
              !adapterA ||
              !adapterB ||
              adapterA === adapterB ||
              sendPromptMutation.isPending
            }
            className="rounded-[3px] bg-[#D4A04A] px-3 py-1 font-mono text-xs font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sendPromptMutation.isPending ? "Starting..." : "Run Comparison"}
          </button>
          <button
            onClick={() => setShowCompareBar(false)}
            className="ml-auto font-mono text-xs text-[#5A5855] hover:text-[#8A8580]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main content: comparison view or normal split */}
      {comparisonSessions ? (
        <div className="min-h-0 flex-1">
          <ComparisonView
            sessionA={comparisonSessions[0]}
            sessionB={comparisonSessions[1]}
            threadId={thread.id}
            onClose={handleCloseComparison}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="min-h-0 flex-1 border-b border-[#2A2A2F] md:w-[60%] md:flex-none md:border-b-0 md:border-r">
            <ChatPanel threadId={thread.id} />
          </div>
          <div className="md:w-[40%] md:flex-none">
            {/* Collapsible workspace header on mobile */}
            <button
              onClick={() => setWorkspaceOpen((v) => !v)}
              className="flex w-full items-center justify-between border-b border-[#2A2A2F] px-4 py-2 text-sm font-medium text-[#8A8580] md:hidden"
            >
              <span>Workspace</span>
              <span className="text-xs">{workspaceOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            <div className={`${workspaceOpen ? "block" : "hidden"} md:block`}>
              <WorkspacePanel threadSlug={thread.slug} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
