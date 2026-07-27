"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

interface CreateThreadModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { title: string; slug: string; domainPackId?: string }) => void;
}

// `threads.listDomainPacks` is `.output(z.any())` for OpenAPI, which
// degenerates the client query type; describe the projected pack shape.
interface DomainPackOption {
  id: string;
  name: string;
  description: string;
  warnings: string[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateThreadModal({
  open,
  onClose,
  onCreate,
}: CreateThreadModalProps) {
  const [title, setTitle] = useState("");
  const [domainPackId, setDomainPackId] = useState("");
  const trpc = useTRPC();

  const packsQuery = useQuery(trpc.threads.listDomainPacks.queryOptions());
  const domainPacks = (packsQuery.data ?? []) as unknown as DomainPackOption[];

  const selectedPack = domainPacks.find((p) => p.id === domainPackId);

  // Close on Escape while the dialog is open (parity with the shared Dialog's
  // keyboard affordances, without pulling in the Bob-themed component).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      slug: slugify(title),
      ...(domainPackId ? { domainPackId } : {}),
    });
    setTitle("");
    setDomainPackId("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-thread-title"
        className="w-full max-w-md rounded-[6px] border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="create-thread-title"
          className="font-serif text-lg text-foreground"
        >
          New Research Thread
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium text-muted-foreground">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Improve Sleep Quality"
              className="mt-1 w-full rounded-[3px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-subtle outline-none focus:border-primary"
              autoFocus
            />
            {title && (
              <div className="mt-1 font-mono text-xs text-subtle">
                slug: {slugify(title)}
              </div>
            )}
          </div>

          {/* Domain Pack (optional) */}
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Domain Pack{" "}
              <span className="font-normal text-subtle">(optional)</span>
            </label>
            <select
              value={domainPackId}
              onChange={(e) => setDomainPackId(e.target.value)}
              className="mt-1 w-full rounded-[3px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">None</option>
              {domainPacks.map((dp) => (
                <option key={dp.id} value={dp.id}>
                  {dp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Domain Pack Warnings */}
          {selectedPack && selectedPack.warnings.length > 0 && (
            <div className="rounded-[3px] border-l-[3px] border-[#C49A3C] bg-[#C49A3C]/10 px-3 py-2">
              {selectedPack.warnings.map((warning) => (
                <p key={warning} className="text-sm text-[#C49A3C]">
                  {warning}
                </p>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[3px] border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-[3px] bg-primary px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
