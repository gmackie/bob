"use client";

import { useState } from "react";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function CapturePage() {
  const [note, setNote] = useState("");
  const [importJson, setImportJson] = useState("");
  const [tab, setTab] = useState<"note" | "import">("note");
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const importMutation = useMutation(
    trpc.imports.importConversations.mutationOptions({
      onSuccess: (data) => {
        setImportJson("");
        void queryClient.invalidateQueries({
          queryKey: trpc.research.listSources.queryKey(),
        });
      },
    }),
  );

  const noteMutation = useMutation(
    trpc.vault.write.mutationOptions({
      onSuccess: () => {
        setNote("");
      },
    }),
  );

  function saveNote() {
    const body = note.trim();
    if (!body) return;
    // Filename-safe timestamp; capture notes land under capture/ in the
    // research vault as plain markdown so they flow through the same
    // extraction pipeline as imported sources.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    noteMutation.mutate({
      vaultKind: "research",
      filePath: `capture/note-${stamp}.md`,
      content: body,
      frontmatter: { source: "capture", createdAt: new Date().toISOString() },
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-3 py-6 md:px-6 md:py-10">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl text-primary">Capture</h1>
          <Link
            href="/"
            className="text-sm text-subtle transition-colors hover:text-muted-foreground"
          >
            Home
          </Link>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Capture mode"
          className="mt-6 flex gap-1 rounded-[6px] bg-card p-1"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setTab((prev) => (prev === "note" ? "import" : "note"));
          }}
        >
          <button
            role="tab"
            id="capture-tab-note"
            aria-selected={tab === "note"}
            aria-controls="capture-panel-note"
            tabIndex={tab === "note" ? 0 : -1}
            onClick={() => setTab("note")}
            className={`flex-1 rounded-[3px] px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              tab === "note"
                ? "bg-border text-foreground"
                : "text-subtle hover:text-muted-foreground"
            }`}
          >
            Quick Note
          </button>
          <button
            role="tab"
            id="capture-tab-import"
            aria-selected={tab === "import"}
            aria-controls="capture-panel-import"
            tabIndex={tab === "import" ? 0 : -1}
            onClick={() => setTab("import")}
            className={`flex-1 rounded-[3px] px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              tab === "import"
                ? "bg-border text-foreground"
                : "text-subtle hover:text-muted-foreground"
            }`}
          >
            Import
          </button>
        </div>

        {/* Note tab */}
        {tab === "note" && (
          <div
            role="tabpanel"
            id="capture-panel-note"
            aria-labelledby="capture-tab-note"
            className="mt-6"
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Capture a thought, link, or idea..."
              className="w-full resize-none rounded-[6px] border border-border bg-card px-4 py-3 text-sm text-foreground placeholder-subtle focus:border-primary/50 focus:outline-none"
              rows={8}
            />
            <div className="mt-3 flex items-center justify-between">
              <span
                className="text-xs text-subtle"
                role="status"
                aria-live="polite"
              >
                {noteMutation.isPending
                  ? "Saving..."
                  : noteMutation.isSuccess
                    ? "Saved to vault"
                    : noteMutation.isError
                      ? `Error: ${noteMutation.error.message}`
                      : ""}
              </span>
              <button
                onClick={saveNote}
                disabled={!note.trim() || noteMutation.isPending}
                className="rounded-[3px] bg-primary px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
              >
                {noteMutation.isPending ? "Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        )}

        {/* Import tab */}
        {tab === "import" && (
          <div
            role="tabpanel"
            id="capture-panel-import"
            aria-labelledby="capture-tab-import"
            className="mt-6"
          >
            <p className="mb-3 text-sm text-muted-foreground">
              Paste a Claude, ChatGPT, or OODA conversation JSON export to
              import it as sources.
            </p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='Paste conversation JSON here...'
              className="w-full resize-none rounded-[6px] border border-border bg-card px-4 py-3 font-mono text-xs text-foreground placeholder-subtle focus:border-primary/50 focus:outline-none"
              rows={12}
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-subtle">
                {importMutation.isPending
                  ? "Importing..."
                  : importMutation.isSuccess
                    ? `Imported successfully`
                    : importMutation.isError
                      ? `Error: ${importMutation.error.message}`
                      : ""}
              </span>
              <button
                onClick={() => {
                  try {
                    const data = JSON.parse(importJson);
                    importMutation.mutate({ rawJson: data, vaultKind: "research" });
                  } catch {
                    // invalid JSON
                  }
                }}
                disabled={!importJson.trim() || importMutation.isPending}
                className="rounded-[3px] bg-primary px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
              >
                Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
