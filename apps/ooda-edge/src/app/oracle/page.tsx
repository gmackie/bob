"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

// Stopwords + Twitter noise stripped before building the topic cloud. Kept
// lean: common English function words plus a few social-media artifacts.
const STOPWORDS = new Set(
  ("the a an and or but if then else for while of to in on at by with from into over "
    + "under this that these those it its is are was were be been being have has had do "
    + "does did will would shall should can could may might must not no yes you your our "
    + "we they them their his her him she he i me my mine ours yours as so than too very "
    + "just about after before between out off up down again once here there all any both "
    + "each few more most other some such only own same what which who whom whose why how "
    + "when where what get got make made like want need know think see new now one two get "
    + "https http com www amp rt via re thread threads follow retweet please thanks thank "
    + "going really actually literally basically today tomorrow yesterday people time day "
    + "week year good great big small first last next best right way lot bit every still")
    .split(/\s+/),
);

function extractTopicTerms(
  sources: { title?: string | null; body?: string | null }[],
): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const raw = `${s.title ?? ""} ${s.body ?? ""}`
      .replace(/https?:\/\/\S+/g, " ") // urls
      .replace(/@\w+/g, " ") // handles
      .toLowerCase();
    const words = raw.match(/[a-z][a-z'-]{3,}/g) ?? [];
    const seenInSource = new Set<string>();
    for (let w of words) {
      w = w.replace(/^[-']+|[-']+$/g, "");
      if (w.length < 4 || STOPWORDS.has(w)) continue;
      // Count once per source so one ranty tweet can't dominate the cloud.
      if (seenInSource.has(w)) continue;
      seenInSource.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 42);
}

function slugifyTopic(term: string): string {
  const base = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return `${base || "topic"}-${Date.now().toString(36)}`;
}

type SourceKindFilter = "x-bookmark" | "chat" | "paper" | "file";

const SOURCE_KIND_GROUPS: Record<SourceKindFilter, string[]> = {
  "x-bookmark": ["x-bookmark"],
  chat: ["chat", "chat-import"],
  paper: ["paper-s2", "paper-openalex"],
  file: ["file"],
};

const SOURCE_BADGE_COLORS: Record<string, string> = {
  "x-bookmark": "text-[#55ACEE] border-[#2A4055]",
  chat: "text-[#C4A5E6] border-[#3A2A55]",
  "chat-import": "text-[#C4A5E6] border-[#3A2A55]",
  "paper-s2": "text-[#7ACB8E] border-[#2A4535]",
  "paper-openalex": "text-[#7ACB8E] border-[#2A4535]",
  file: "text-[#8A8580] border-[#2A2825]",
  youtube: "text-[#FF4444] border-[#552A2A]",
};

const SOURCE_LABELS: Record<string, string> = {
  "x-bookmark": "X Bookmark",
  chat: "Chat",
  "chat-import": "Chat Import",
  "paper-s2": "Paper",
  "paper-openalex": "Paper",
  file: "File",
  youtube: "YouTube",
};

interface OracleChunk {
  unitId: string;
  sourceId: number;
  content: string;
  tokenCount: number;
  headingContext: string | null;
  score: number;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceKind: string;
  contentAsOf: Date | null;
}

interface OracleResult {
  chunks: OracleChunk[];
  confidence: number;
  queryId: string;
  latencyMs: number;
}

export default function OraclePage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeFilters, setActiveFilters] = useState<Set<SourceKindFilter>>(
    new Set(["x-bookmark", "chat", "paper", "file"]),
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const trpc = useTRPC();

  const oracleQuery = useQuery({
    ...trpc.oracle.query.queryOptions(
      { task: "knowledge search", question: submittedQuery, topK: 12 },
    ),
    enabled: submittedQuery.length > 0,
  });

  const feedbackMutation = useMutation(
    trpc.oracle.logFeedback.mutationOptions(),
  );

  const sourcesQuery = useQuery({
    ...trpc.research.listSources.queryOptions(),
    staleTime: 60_000,
  });

  // Recent research threads — "what you've been chatting about". Public query,
  // powers the landing state so an empty Oracle greets you with your work-in-
  // progress instead of a bare search box.
  const threadsQuery = useQuery({
    ...trpc.threads.list.queryOptions(),
    staleTime: 30_000,
  });
  const recentThreads = (threadsQuery.data as any[] | undefined)?.slice(0, 6) ?? [];

  // Topic cloud, derived from source content already loaded for the sidebar —
  // no extra round-trip. "What you've been exploring", weighted by how many
  // sources mention each term.
  const topicTerms = useMemo(
    () => extractTopicTerms((sourcesQuery.data as any[] | undefined) ?? []),
    [sourcesQuery.data],
  );

  // Click a topic → start the next discussion. Create a research thread seeded
  // with the term and jump into it. If we are not authenticated (public
  // preview), fall back to running a knowledge-base search for the term.
  const createThreadMutation = useMutation(
    trpc.threads.create.mutationOptions({
      onSuccess: (rows: any) => {
        const created = Array.isArray(rows) ? rows[0] : rows;
        if (created?.slug) window.location.assign(`/threads/${created.slug}`);
      },
    }),
  );

  const startDiscussion = useCallback(
    (term: string) => {
      const title = term.charAt(0).toUpperCase() + term.slice(1);
      createThreadMutation.mutate(
        { title, slug: slugifyTopic(term) },
        {
          onError: () => {
            // Not authenticated (or create failed): fall back to search so the
            // click is never a dead end.
            setQuery(term);
            setSubmittedQuery(term);
            setSelectedIndex(0);
          },
        },
      );
    },
    [createThreadMutation],
  );

  const result = oracleQuery.data as OracleResult | undefined;

  const filteredChunks = result?.chunks.filter((c) => {
    for (const [, kinds] of Object.entries(SOURCE_KIND_GROUPS)) {
      for (const filter of activeFilters) {
        if (SOURCE_KIND_GROUPS[filter]!.includes(c.sourceKind)) return true;
      }
    }
    return false;
  }) ?? [];

  const selectedChunk = filteredChunks[selectedIndex] ?? null;

  const recentSources = (sourcesQuery.data as any[] | undefined)
    ?.sort((a, b) => {
      const dateA = new Date(a.importedAt ?? 0).getTime();
      const dateB = new Date(b.importedAt ?? 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 5) ?? [];

  const sourceCountsByKind = (sourcesQuery.data as any[] | undefined)?.reduce(
    (acc: Record<string, number>, s: any) => {
      acc[s.kind] = (acc[s.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  ) ?? {};

  const totalSources = Object.values(sourceCountsByKind).reduce((a, b) => a + b, 0);

  const handleSearch = useCallback(() => {
    if (query.trim()) {
      setSubmittedQuery(query.trim());
      setSelectedIndex(0);
    }
  }, [query]);

  const toggleFilter = useCallback((filter: SourceKindFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        if (next.size > 1) next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }, []);

  const sendFeedback = useCallback(
    (score: number) => {
      if (result?.queryId) {
        feedbackMutation.mutate({
          queryId: result.queryId,
          used: true,
          score,
        });
      }
    },
    [result?.queryId, feedbackMutation],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (e.key === "/" && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isInput) return;

      if (e.key === "j" && filteredChunks.length > 0) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredChunks.length - 1));
        return;
      }
      if (e.key === "k" && filteredChunks.length > 0) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "o" && selectedChunk?.sourceUrl) {
        e.preventDefault();
        window.open(selectedChunk.sourceUrl, "_blank");
        return;
      }
      if (e.key === "c" && selectedChunk) {
        e.preventDefault();
        void navigator.clipboard.writeText(selectedChunk.content);
        return;
      }
      if ((e.key === "=" || e.key === "+") && result) {
        e.preventDefault();
        sendFeedback(1);
        return;
      }
      if (e.key === "-" && result) {
        e.preventDefault();
        sendFeedback(-1);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredChunks.length, selectedChunk, result, sendFeedback]);

  useEffect(() => {
    const el = resultsRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const filterCount = (filter: SourceKindFilter) =>
    SOURCE_KIND_GROUPS[filter]!.reduce(
      (sum, k) => sum + (sourceCountsByKind[k] ?? 0),
      0,
    );

  return (
    <div className="flex h-screen flex-col bg-[#111113] text-[#E8E4DF]">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#2A2825] bg-[#18181A] px-4">
        <div className="flex items-center gap-4">
          <span className="text-[15px] font-bold tracking-[2px] text-[#D4A04A]">
            OODA
          </span>
          <nav className="flex gap-1">
            {[
              { href: "/oracle", label: "Oracle", active: true },
              { href: "/research", label: "Research", active: false },
              { href: "/threads", label: "Threads", active: false },
              { href: "/capture", label: "Capture", active: false },
              { href: "/health", label: "Health", active: false },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`rounded px-2.5 py-1 text-xs ${
                  link.active
                    ? "bg-[#2A2825] text-[#E8E4DF]"
                    : "text-[#8A8580] hover:text-[#E8E4DF]"
                }`}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[#6B6560]">
          <span className="rounded-full border border-[#2A2825] bg-[#1E1E20] px-2 py-0.5 tabular-nums">
            {result?.chunks.length ?? "—"} chunks
          </span>
          <span className="rounded-full border border-[#2A2825] bg-[#1E1E20] px-2 py-0.5 tabular-nums">
            {totalSources} sources
          </span>
          <span className="text-[#4A4845]">
            <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px] text-[#6B6560]">
              /
            </kbd>{" "}
            search{" "}
            <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px] text-[#6B6560]">
              ?
            </kbd>{" "}
            help
          </span>
        </div>
      </div>

      {/* Three-pane layout */}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_340px]">
        {/* Left pane: Filters + Import inbox */}
        <div className="overflow-y-auto border-r border-[#2A2825] bg-[#151517] p-3">
          <FilterSection title="Source Type">
            {(
              [
                ["x-bookmark", "X Bookmarks"],
                ["chat", "AI Conversations"],
                ["paper", "Papers"],
                ["file", "Files"],
              ] as const
            ).map(([key, label]) => (
              <FilterOption
                key={key}
                label={label}
                count={filterCount(key)}
                checked={activeFilters.has(key)}
                onClick={() => toggleFilter(key)}
              />
            ))}
          </FilterSection>

          <FilterSection title="Search Mode">
            <FilterOption label="Hybrid (semantic + text)" checked={true} onClick={() => {}} />
          </FilterSection>

          {/* Import inbox */}
          <div className="mt-2 border-t border-[#2A2825] pt-3">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#6B6560]">
              Recent Imports{" "}
              {recentSources.length > 0 && (
                <span className="text-[#D4A04A]">{recentSources.length} latest</span>
              )}
            </div>
            {recentSources.map((s: any) => (
              <div
                key={s.id}
                className="mb-1 rounded border-l-2 border-[#D4A04A] py-1.5 pl-2 hover:bg-[#1E1E20]"
              >
                <div className="truncate text-[11px] text-[#C0BAB4]">
                  {s.title || s.externalId || "Untitled"}
                </div>
                <div className="mt-0.5 text-[10px] text-[#5A5550]">
                  {s.kind} &middot;{" "}
                  {s.importedAt
                    ? formatRelativeTime(new Date(s.importedAt))
                    : "unknown"}
                </div>
              </div>
            ))}
            {recentSources.length === 0 && (
              <div className="text-[11px] text-[#4A4845]">No sources yet</div>
            )}
            <a
              href="/capture"
              className="mt-1.5 block text-[11px] text-[#D4A04A] hover:underline"
            >
              View all imports &rarr;
            </a>
          </div>
        </div>

        {/* Center pane: Search + Results */}
        <div className="flex flex-col overflow-y-auto">
          {/* Search bar */}
          <div className="sticky top-0 z-10 border-b border-[#2A2825] bg-[#151517] p-3">
            <div className="flex items-center gap-2 rounded-md border border-[#3A3835] bg-[#1E1E20] px-3 py-2">
              <span className="text-sm text-[#6B6560]">&#x1F50D;</span>
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                  if (e.key === "Escape") searchInputRef.current?.blur();
                }}
                placeholder="Ask your knowledge base..."
                className="flex-1 bg-transparent text-sm text-[#E8E4DF] placeholder-[#4A4845] outline-none"
              />
              <span className="text-[11px] text-[#4A4845]">
                <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px]">
                  Enter
                </kbd>
              </span>
            </div>
            {result && (
              <div className="mt-1.5 flex justify-between text-[11px] text-[#6B6560]">
                <span>
                  {filteredChunks.length} results &middot; {result.latencyMs}ms &middot;
                  confidence {result.confidence.toFixed(2)}
                </span>
                <span>query: hybrid &middot; topK: 12</span>
              </div>
            )}
            {oracleQuery.isFetching && (
              <div className="mt-1.5 text-[11px] text-[#D4A04A]">
                Searching...
              </div>
            )}
          </div>

          {/* Results list */}
          <div ref={resultsRef} className="flex-1 p-3">
            {!submittedQuery && !oracleQuery.isFetching && (
              <ExploreLanding
                terms={topicTerms}
                threads={recentThreads}
                loadingThreads={threadsQuery.isLoading}
                loadingTerms={sourcesQuery.isLoading}
                onPickTopic={startDiscussion}
                starting={createThreadMutation.isPending}
              />
            )}

            {filteredChunks.map((chunk, i) => (
              <div
                key={chunk.unitId}
                onClick={() => setSelectedIndex(i)}
                className={`mb-1.5 cursor-pointer rounded-md border p-2.5 transition-colors ${
                  i === selectedIndex
                    ? "border-[#D4A04A] bg-[#1A1915]"
                    : "border-[#2A2825] hover:border-[#3A3835] hover:bg-[#18181A]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <ScoreBar score={chunk.score} />
                  <SourceBadge kind={chunk.sourceKind} />
                  <span className="truncate text-[13px] font-medium text-[#D0CAC4]">
                    {chunk.sourceTitle ?? "Untitled"}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-[#8A8580]">
                  {chunk.content.slice(0, 200)}
                </div>
                <div className="mt-1.5 flex gap-3 text-[10px] text-[#5A5550]">
                  <span>{chunk.tokenCount} tokens</span>
                  {chunk.headingContext && <span>{chunk.headingContext}</span>}
                  {chunk.contentAsOf && (
                    <span>
                      {new Date(chunk.contentAsOf).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {filteredChunks.length > 0 && (
              <div className="mt-2 text-center text-[11px] text-[#4A4845]">
                <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px]">
                  j
                </kbd>
                /
                <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px]">
                  k
                </kbd>{" "}
                navigate &middot;{" "}
                <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px]">
                  o
                </kbd>{" "}
                open source &middot;{" "}
                <kbd className="rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px]">
                  c
                </kbd>{" "}
                copy
              </div>
            )}

            {oracleQuery.isError && (
              <div className="mt-4 rounded border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400">
                {oracleQuery.error.message}
              </div>
            )}
          </div>
        </div>

        {/* Right pane: Source detail */}
        <div className="flex flex-col overflow-y-auto border-l border-[#2A2825] bg-[#151517]">
          {selectedChunk ? (
            <>
              <div className="border-b border-[#2A2825] p-3">
                <div className="text-[15px] font-semibold text-[#E8E4DF]">
                  {selectedChunk.sourceTitle ?? "Untitled"}
                </div>
                {selectedChunk.sourceUrl && (
                  <a
                    href={selectedChunk.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block break-all text-[11px] text-[#D4A04A] hover:underline"
                  >
                    {selectedChunk.sourceUrl}
                  </a>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#6B6560]">
                  <SourceBadge kind={selectedChunk.sourceKind} />
                  <span>Score: {selectedChunk.score.toFixed(2)}</span>
                  <span>{selectedChunk.tokenCount} tokens</span>
                  {selectedChunk.contentAsOf && (
                    <span>
                      {new Date(selectedChunk.contentAsOf).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex-1 p-3">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#5A5550]">
                  Matched Chunk
                </div>
                <div className="rounded border border-[#2A2825] bg-[#1A1A1C] p-2.5 text-xs leading-relaxed text-[#A09A94]">
                  <HighlightedContent
                    content={selectedChunk.content}
                    query={submittedQuery}
                  />
                </div>

                {selectedChunk.headingContext && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-[#5A5550]">
                      Heading Context
                    </div>
                    <div className="text-xs text-[#8A8580]">
                      {selectedChunk.headingContext}
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-[#5A5550]">
                    Score
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-[#2A2825]">
                      <div
                        className="h-full rounded-full bg-[#D4A04A]"
                        style={{ width: `${selectedChunk.score * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium tabular-nums text-[#D4A04A]">
                      {selectedChunk.score.toFixed(3)}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#5A5550]">
                    Combined score (0.6 semantic + 0.2 recency + 0.1 quality + 0.1 full-text)
                  </div>
                </div>
              </div>

              <div className="flex gap-2 border-t border-[#2A2825] p-3">
                {selectedChunk.sourceUrl && (
                  <ActionButton
                    label="Open Source"
                    kbd="o"
                    primary
                    onClick={() =>
                      window.open(selectedChunk.sourceUrl!, "_blank")
                    }
                  />
                )}
                <ActionButton
                  label="Copy"
                  kbd="c"
                  onClick={() =>
                    void navigator.clipboard.writeText(selectedChunk.content)
                  }
                />
                <ActionButton
                  label="+1"
                  kbd="+"
                  onClick={() => sendFeedback(1)}
                  active={feedbackMutation.isSuccess}
                />
                <ActionButton
                  label="-1"
                  kbd="-"
                  onClick={() => sendFeedback(-1)}
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[#4A4845]">
              {submittedQuery
                ? "Select a result to view details"
                : "Search to see results"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const THREAD_STATUS_COLOR: Record<string, string> = {
  active: "bg-[#6BBF59]",
  paused: "bg-[#D4A04A]",
  completed: "bg-[#55ACEE]",
  archived: "bg-[#4A4845]",
};

// Landing state for an unqueried Oracle: a topic cloud of what you've been
// exploring (click a word to open the next discussion), with a compact strip
// of recent threads underneath. Search stays one keystroke away.
function ExploreLanding({
  terms,
  threads,
  loadingThreads,
  loadingTerms,
  onPickTopic,
  starting,
}: {
  terms: { term: string; count: number }[];
  threads: any[];
  loadingThreads: boolean;
  loadingTerms: boolean;
  onPickTopic: (term: string) => void;
  starting: boolean;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center py-10">
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[3px] text-[#6B6560]">
          What you&rsquo;ve been exploring
        </div>
        <h2 className="mt-1 font-serif text-[28px] leading-tight text-[#E8E4DF]">
          Pick a thread of thought
        </h2>
        <p className="mt-1.5 text-xs text-[#6B6560]">
          Every word is a live topic from your sources. Click one to start the
          next discussion.
        </p>
      </div>

      <WordCloud
        terms={terms}
        loading={loadingTerms}
        onPick={onPickTopic}
        disabled={starting}
      />

      {starting && (
        <div className="mt-2 text-center text-xs text-[#D4A04A]">
          Opening a new discussion&hellip;
        </div>
      )}

      {/* Recent threads strip */}
      <div className="mt-8 border-t border-[#2A2825] pt-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[2px] text-[#6B6560]">
            Continue where you left off
          </div>
          <a
            href="/threads"
            className="text-[11px] text-[#D4A04A] hover:underline"
          >
            All threads &rarr;
          </a>
        </div>
        {loadingThreads && (
          <div className="text-xs text-[#4A4845]">Loading threads&hellip;</div>
        )}
        {!loadingThreads && threads.length === 0 && (
          <div className="text-xs text-[#4A4845]">
            No discussions yet &mdash; pick a topic above to start one.
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {threads.map((t) => (
            <a
              key={t.id}
              href={`/threads/${t.slug}`}
              className="group flex items-center gap-2.5 rounded-md border border-[#2A2825] bg-[#151517] px-3 py-2 transition-colors hover:border-[#D4A04A]/50 hover:bg-[#1A1915]"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  THREAD_STATUS_COLOR[t.status] ?? "bg-[#4A4845]"
                }`}
                title={t.status}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-[#C0BAB4] group-hover:text-[#E8E4DF]">
                {t.title || "Untitled thread"}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-[#5A5550]">
                {t.createdAt ? formatRelativeTime(new Date(t.createdAt)) : ""}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// Weighted topic cloud. Font size + warmth scale with how many sources mention
// the term; hover lifts and brightens. Clicking opens the next discussion.
function WordCloud({
  terms,
  loading,
  onPick,
  disabled,
}: {
  terms: { term: string; count: number }[];
  loading: boolean;
  onPick: (term: string) => void;
  disabled: boolean;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center text-sm text-[#4A4845]">
        Reading your sources&hellip;
      </div>
    );
  }
  if (terms.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-center">
        <div className="text-sm text-[#8A8580]">
          Not enough source content yet to map your topics.
        </div>
        <a
          href="/capture"
          className="text-sm text-[#D4A04A] hover:underline"
        >
          Import sources &rarr;
        </a>
      </div>
    );
  }

  const max = terms[0]!.count;
  const min = terms[terms.length - 1]!.count;
  const span = Math.max(1, max - min);
  // Bigger, warmer terms for higher counts. Weight in [0,1].
  const styleFor = (count: number) => {
    const w = (count - min) / span;
    const size = 13 + Math.round(w * 33); // 13px … 46px
    // Warm ramp: dim taupe → bright amber as weight rises.
    const shades = ["#6B6560", "#8A7B55", "#B08A3E", "#D4A04A", "#F0B860"];
    const color = shades[Math.min(shades.length - 1, Math.round(w * (shades.length - 1)))]!;
    const weight = w > 0.66 ? 600 : w > 0.33 ? 500 : 400;
    return { fontSize: `${size}px`, color, fontWeight: weight };
  };

  return (
    <div className="mt-6 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-2 px-2">
      {terms.map(({ term, count }) => {
        const s = styleFor(count);
        return (
          <button
            key={term}
            type="button"
            disabled={disabled}
            onClick={() => onPick(term)}
            title={`${count} source${count === 1 ? "" : "s"} — start a discussion`}
            style={s}
            className="cursor-pointer font-serif leading-none tracking-tight transition-all duration-150 hover:-translate-y-0.5 hover:brightness-125 disabled:cursor-wait disabled:opacity-60"
          >
            {term}
          </button>
        );
      })}
    </div>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[#6B6560]">
        {title}
      </div>
      {children}
    </div>
  );
}

function FilterOption({
  label,
  count,
  checked,
  onClick,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
        checked ? "text-[#D4A04A]" : "text-[#A09A94]"
      } hover:bg-[#1E1E20]`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-sm border ${
          checked
            ? "border-[#D4A04A] bg-[#D4A04A]"
            : "border-[#3A3835]"
        }`}
      />
      {label}
      {count !== undefined && (
        <span className="ml-auto tabular-nums text-[11px] text-[#4A4845]">
          {count}
        </span>
      )}
    </button>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="h-1 w-10 overflow-hidden rounded-full bg-[#2A2825]">
        <div
          className="h-full rounded-full bg-[#D4A04A]"
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <span className="min-w-[28px] text-[11px] tabular-nums text-[#D4A04A]">
        {score.toFixed(2)}
      </span>
    </div>
  );
}

function SourceBadge({ kind }: { kind: string }) {
  const colors = SOURCE_BADGE_COLORS[kind] ?? "text-[#8A8580] border-[#2A2825]";
  return (
    <span
      className={`rounded border bg-[#1E1E20] px-1.5 py-px text-[10px] uppercase tracking-wider ${colors}`}
    >
      {SOURCE_LABELS[kind] ?? kind}
    </span>
  );
}

function HighlightedContent({
  content,
  query,
}: {
  content: string;
  query: string;
}) {
  if (!query.trim()) return <>{content}</>;

  const words = query
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (words.length === 0) return <>{content}</>;

  const regex = new RegExp(`(${words.join("|")})`, "gi");
  const parts = content.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="font-medium text-[#D4A04A]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function ActionButton({
  label,
  kbd: kbdKey,
  primary,
  active,
  onClick,
}: {
  label: string;
  kbd?: string;
  primary?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2.5 py-1.5 text-[11px] transition-colors ${
        primary
          ? "border-[#D4A04A] bg-[#D4A04A] font-semibold text-[#111113] hover:opacity-90"
          : active
            ? "border-[#D4A04A] bg-[#1E1E20] text-[#D4A04A]"
            : "border-[#3A3835] bg-[#1E1E20] text-[#A09A94] hover:border-[#D4A04A] hover:text-[#D4A04A]"
      }`}
    >
      {label}
      {kbdKey && (
        <kbd className="ml-1 rounded border border-[#3A3835] bg-[#2A2825] px-1 py-px text-[10px] text-[#6B6560]">
          {kbdKey}
        </kbd>
      )}
    </button>
  );
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
