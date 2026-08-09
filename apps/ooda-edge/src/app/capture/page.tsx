"use client";

import { useState, useEffect } from "react";

import { useTRPC } from "~/trpc/react";
import { useQuery, useMutation } from "@tanstack/react-query";

// Capture-first: the common case is "I want to talk about something." Drop a
// thought (screenshots + agent vision are the next layer), see what's already in
// your KB about it, and start a conversation in one step — the thread it opens
// has the Bob / Make-it-a-project actions for turning ideas into tasks.

function slugifyTitle(term: string): string {
  const base = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return `${base || "capture"}-${Date.now().toString(36)}`;
}

interface OracleChunk {
  unitId: string;
  content: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceKind: string;
  score: number;
}

export default function CapturePage() {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [images, setImages] = useState<
    { mimeType: string; dataBase64: string; preview: string }[]
  >([]);
  const trpc = useTRPC();

  // Paste a cropped screenshot straight into the capture box.
  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const comma = dataUrl.indexOf(",");
      if (comma < 0) return;
      setImages((prev) =>
        prev.length >= 6
          ? prev
          : [
              ...prev,
              {
                mimeType: file.type,
                dataBase64: dataUrl.slice(comma + 1),
                preview: dataUrl,
              },
            ],
      );
    };
    reader.readAsDataURL(file);
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    for (const it of Array.from(e.clipboardData?.items ?? [])) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) addImageFile(f);
      }
    }
  };

  // Debounce the capture text before searching the KB.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 600);
    return () => clearTimeout(id);
  }, [text]);

  const relatedQuery = useQuery({
    ...trpc.oracle.query.queryOptions({
      task: "capture",
      question: debounced,
      topK: 5,
    }),
    enabled: debounced.length >= 12,
    staleTime: 60_000,
    retry: false,
  });
  const related =
    ((relatedQuery.data as { chunks?: OracleChunk[] } | undefined)?.chunks ??
      []) as OracleChunk[];

  const createThread = useMutation(
    trpc.threads.create.mutationOptions({
      onSuccess: (rows: unknown) => {
        const t = (Array.isArray(rows) ? rows[0] : rows) as
          | { slug?: string }
          | undefined;
        if (t?.slug) {
          // Hand the capture (text + screenshots) to the new thread. Images are
          // too big for a URL param, so ride sessionStorage; ChatPanel consumes
          // it on mount and auto-sends.
          try {
            sessionStorage.setItem(
              "ooda-capture-seed",
              JSON.stringify({
                prompt: text.trim(),
                images: images.map((i) => ({
                  mimeType: i.mimeType,
                  dataBase64: i.dataBase64,
                })),
                ts: Date.now(),
              }),
            );
          } catch {
            // fall back to a text-only URL seed below
          }
          window.location.assign(`/threads/${t.slug}`);
        }
      },
    }),
  );

  const importMutation = useMutation(
    trpc.imports.importConversations.mutationOptions({
      onSuccess: () => setImportJson(""),
    }),
  );

  const startConversation = () => {
    const body = text.trim();
    if (!body) return;
    const title = body.split("\n")[0]!.slice(0, 80) || "New conversation";
    createThread.mutate({ title, slug: slugifyTitle(title) });
  };

  return (
    <div className="min-h-screen bg-[#111113] text-[#E8E4DF]">
      <div className="mx-auto max-w-3xl px-3 py-10 md:px-6 md:py-16">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-serif text-2xl text-[#D4A04A]">Capture</h1>
          <a
            href="/oracle"
            className="text-sm text-[#5A5855] transition-colors hover:text-[#8A8580]"
          >
            Oracle &rarr;
          </a>
        </div>

        {/* Primary capture box */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              startConversation();
            }
          }}
          autoFocus
          placeholder="What's on your mind? Paste a screenshot, drop a thought or a link…"
          className="w-full resize-none rounded-[8px] border border-[#2A2A2F] bg-[#1A1A1E] px-4 py-4 text-[15px] leading-relaxed text-[#E8E4DF] placeholder-[#5A5855] focus:border-[#D4A04A]/50 focus:outline-none"
          rows={5}
        />
        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.preview}
                  alt="screenshot"
                  className="h-16 w-16 rounded-[4px] border border-[#2A2A2F] object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setImages((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#111113] text-[10px] text-[#8A8580] hover:text-[#E8E4DF]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-[#5A5855]">
            {createThread.isPending
              ? "Opening conversation…"
              : createThread.isError
                ? `Error: ${createThread.error.message}`
                : "Paste a screenshot — the agent can see it and can file tasks in your projects."}
          </span>
          <button
            onClick={startConversation}
            disabled={!text.trim() || createThread.isPending}
            className="rounded-[4px] bg-[#D4A04A] px-4 py-2 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {createThread.isPending ? "Starting…" : "Start conversation"}
            <kbd className="ml-2 rounded border border-[#111113]/30 px-1 text-[10px] opacity-70">
              &#8984;&#8629;
            </kbd>
          </button>
        </div>

        {/* Related from the KB, surfaced live */}
        {debounced.length >= 12 && (
          <div className="mt-8">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[2px] text-[#6B6560]">
              Related in your knowledge base
              {relatedQuery.isFetching && (
                <span className="text-[#D4A04A]">searching…</span>
              )}
            </div>
            {related.length === 0 && !relatedQuery.isFetching && (
              <div className="text-xs text-[#4A4845]">
                Nothing related yet &mdash; this&rsquo;ll be a fresh thread.
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {related.map((c) => (
                <a
                  key={c.unitId}
                  href={c.sourceUrl ?? "#"}
                  target={c.sourceUrl ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="group rounded-md border border-[#2A2825] bg-[#151517] px-3 py-2 transition-colors hover:border-[#D4A04A]/50 hover:bg-[#1A1915]"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-[#2A2825] bg-[#1E1E20] px-1.5 py-px text-[9px] uppercase tracking-wider text-[#8A8580]">
                      {c.sourceKind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#D0CAC4] group-hover:text-[#E8E4DF]">
                      {c.sourceTitle ?? "Untitled"}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-[#8A8580]">
                    {c.content.slice(0, 180)}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Import, tucked away */}
        <div className="mt-12 border-t border-[#2A2825] pt-4">
          <button
            onClick={() => setShowImport((v) => !v)}
            className="text-[11px] text-[#6B6560] hover:text-[#8A8580]"
          >
            {showImport ? "−" : "+"} Import past chats (Claude / ChatGPT /
            Grok / OODA)
          </button>
          {showImport && (
            <div className="mt-3">
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder="Paste conversation JSON export…"
                className="w-full resize-none rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] px-3 py-2 font-mono text-xs text-[#E8E4DF] placeholder-[#5A5855] focus:border-[#D4A04A]/50 focus:outline-none"
                rows={6}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-[#5A5855]">
                  {importMutation.isPending
                    ? "Importing…"
                    : importMutation.isSuccess
                      ? "Imported"
                      : importMutation.isError
                        ? `Error: ${importMutation.error.message}`
                        : "Large exports (100s of MB) use scripts/import-grok-export.ts instead."}
                </span>
                <button
                  onClick={() => {
                    try {
                      importMutation.mutate({
                        rawJson: JSON.parse(importJson),
                        vaultKind: "research",
                      });
                    } catch {
                      // invalid JSON — ignore
                    }
                  }}
                  disabled={!importJson.trim() || importMutation.isPending}
                  className="rounded-[3px] border border-[#3A3835] px-3 py-1 text-xs text-[#A09A94] hover:border-[#D4A04A] hover:text-[#D4A04A] disabled:opacity-40"
                >
                  Import
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
