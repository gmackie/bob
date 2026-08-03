"use client";

import { useState } from "react";

import { useTRPC } from "~/trpc/react";
import { useQuery, useMutation } from "@tanstack/react-query";

import { ChatPanel } from "./chat-panel";
import { WorkspacePanel } from "./workspace-panel";
import { ComparisonView } from "./comparison-view";
import { BobDispatchBar } from "./bob-dispatch-bar";

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
  archived: "bg-subtle",
  completed: "bg-blue-500",
};

interface ComparisonSession {
  id: string;
  adapterId: string;
}

export function ThreadShell({ thread }: ThreadShellProps) {
  const [showCompareBar, setShowCompareBar] = useState(false);
  const [showDispatchBar, setShowDispatchBar] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [adapterA, setAdapterA] = useState("");
  const [adapterB, setAdapterB] = useState("");
  const [comparePrompt, setComparePrompt] = useState("");
  const [comparisonSessions, setComparisonSessions] = useState<
    [ComparisonSession, ComparisonSession] | null
  >(null);

  const trpc = useTRPC();

  // Get available runners. `runner.listDevices` is `.output(z.any())` for
  // OpenAPI, which degenerates the client query type — cast to the row shape
  // we actually read (`id`).
  const runnersQuery = useQuery(trpc.runner.listDevices.queryOptions());
  const firstRunner = (runnersQuery.data as unknown as { id: string }[] | undefined)?.[0];

  // Get adapters for the first available runner
  const adaptersQuery = useQuery({
    ...trpc.runner.listAdapters.queryOptions({
      runnerId: firstRunner?.id ?? "",
    }),
    enabled: !!firstRunner?.id && showCompareBar,
  });

  // `runner.listAdapters` returns `string[]` but is `.output(z.any())`.
  const adapters = (adaptersQuery.data ?? []) as unknown as string[];

  const sendPromptMutation = useMutation(
    trpc.runner.sendPrompt.mutationOptions(),
  );

  const handleRunComparison = () => {
    if (!adapterA || !adapterB || !firstRunner) return;

    // Run the same user-authored prompt through both adapters so the
    // side-by-side view actually compares them on the question at hand.
    const prompt = comparePrompt.trim();
    if (!prompt) return;

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
    setComparePrompt("");
  };

  return (
    <div data-testid="thread-shell" className="flex h-screen flex-col bg-background">
      {/* Header. `min-w-0` + `truncate` on the title lets it shrink /
          ellipsis under sibling flex items (status dot, badges, Compare
          button). Without the min-w-0 guard the title forces the flex
          container wider than the viewport on narrow widths. */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[thread.status] ?? "bg-subtle"}`}
          title={thread.status}
        />
        <h1 className="min-w-0 truncate font-serif text-lg text-foreground">
          {thread.title}
        </h1>
        {thread.domainPackId && (
          <span className="hidden shrink-0 rounded-[3px] bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground sm:inline">
            {thread.domainPackId}
          </span>
        )}
        <span className="ml-auto hidden shrink-0 rounded-[3px] bg-card px-2 py-0.5 text-xs text-subtle sm:inline">
          {thread.status}
        </span>
        <button
          onClick={() => setShowDispatchBar((v) => !v)}
          className={`shrink-0 rounded-[3px] border px-3 py-1.5 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            showDispatchBar
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          Dispatch to Bob
        </button>
        <button
          onClick={() => setShowCompareBar((v) => !v)}
          className={`shrink-0 rounded-[3px] border px-3 py-1.5 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            showCompareBar || comparisonSessions
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          Compare
        </button>
      </header>

      {showDispatchBar && !comparisonSessions && (
        <BobDispatchBar
          threadSlug={thread.slug}
          threadId={thread.id}
          onClose={() => setShowDispatchBar(false)}
        />
      )}

      {/* Comparison config bar. flex-wrap + gap-y so the Adapters:
          label, the two selects, vs, Run, and Cancel reflow onto
          multiple rows on narrow widths instead of clipping or causing
          horizontal scroll. */}
      {showCompareBar && !comparisonSessions && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-primary/40 bg-[#2E2A1A] px-4 py-2">
          <span className="font-mono text-xs text-primary">Adapters:</span>
          <select
            value={adapterA}
            onChange={(e) => setAdapterA(e.target.value)}
            className="rounded-[3px] border border-primary/30 bg-card px-2 py-1 font-mono text-xs text-foreground outline-none"
          >
            <option value="">Select A</option>
            {adapters.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="font-mono text-xs text-subtle">vs</span>
          <select
            value={adapterB}
            onChange={(e) => setAdapterB(e.target.value)}
            className="rounded-[3px] border border-primary/30 bg-card px-2 py-1 font-mono text-xs text-foreground outline-none"
          >
            <option value="">Select B</option>
            {adapters.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={comparePrompt}
            onChange={(e) => setComparePrompt(e.target.value)}
            placeholder="Prompt to run through both…"
            aria-label="Comparison prompt"
            className="min-w-0 flex-1 basis-48 rounded-[3px] border border-primary/30 bg-card px-2 py-1 font-mono text-xs text-foreground placeholder-subtle outline-none focus:border-primary"
          />
          <button
            onClick={handleRunComparison}
            disabled={
              !adapterA ||
              !adapterB ||
              adapterA === adapterB ||
              !comparePrompt.trim() ||
              sendPromptMutation.isPending
            }
            className="rounded-[3px] bg-primary px-3 py-1 font-mono text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sendPromptMutation.isPending ? "Starting..." : "Run Comparison"}
          </button>
          <button
            onClick={() => setShowCompareBar(false)}
            className="ml-auto font-mono text-xs text-subtle hover:text-muted-foreground"
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
          <div className="min-h-0 flex-1 border-b border-border md:w-[60%] md:flex-none md:border-b-0 md:border-r">
            <ChatPanel threadId={thread.id} />
          </div>
          <div className="md:w-[40%] md:flex-none">
            {/* Collapsible workspace header on mobile */}
            <button
              onClick={() => setWorkspaceOpen((v) => !v)}
              className="flex w-full items-center justify-between border-b border-border px-4 py-2 text-sm font-medium text-muted-foreground md:hidden"
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
