"use client";

import { useState } from "react";

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

  return (
    <div className="min-h-screen bg-[#111113] text-[#E8E4DF]">
      <div className="mx-auto max-w-3xl px-3 py-6 md:px-6 md:py-10">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-2xl text-[#D4A04A]">Capture</h1>
          <a
            href="/"
            className="text-sm text-[#5A5855] transition-colors hover:text-[#8A8580]"
          >
            Home
          </a>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 rounded-[6px] bg-[#1A1A1E] p-1">
          <button
            onClick={() => setTab("note")}
            className={`flex-1 rounded-[3px] px-4 py-2 text-sm font-medium transition-colors ${
              tab === "note"
                ? "bg-[#2A2A2F] text-[#E8E4DF]"
                : "text-[#5A5855] hover:text-[#8A8580]"
            }`}
          >
            Quick Note
          </button>
          <button
            onClick={() => setTab("import")}
            className={`flex-1 rounded-[3px] px-4 py-2 text-sm font-medium transition-colors ${
              tab === "import"
                ? "bg-[#2A2A2F] text-[#E8E4DF]"
                : "text-[#5A5855] hover:text-[#8A8580]"
            }`}
          >
            Import
          </button>
        </div>

        {/* Note tab */}
        {tab === "note" && (
          <div className="mt-6">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Capture a thought, link, or idea..."
              className="w-full resize-none rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] px-4 py-3 text-sm text-[#E8E4DF] placeholder-[#5A5855] focus:border-[#D4A04A]/50 focus:outline-none"
              rows={8}
            />
            <div className="mt-3 flex justify-end">
              <button
                disabled={!note.trim()}
                className="rounded-[3px] bg-[#D4A04A] px-4 py-2 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Save Note
              </button>
            </div>
          </div>
        )}

        {/* Import tab */}
        {tab === "import" && (
          <div className="mt-6">
            <p className="mb-3 text-sm text-[#8A8580]">
              Paste a Claude, ChatGPT, or OODA conversation JSON export to
              import it as sources.
            </p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='Paste conversation JSON here...'
              className="w-full resize-none rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] px-4 py-3 font-mono text-xs text-[#E8E4DF] placeholder-[#5A5855] focus:border-[#D4A04A]/50 focus:outline-none"
              rows={12}
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[#5A5855]">
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
                className="rounded-[3px] bg-[#D4A04A] px-4 py-2 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-40"
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
