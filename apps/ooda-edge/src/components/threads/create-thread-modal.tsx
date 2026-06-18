"use client";

import { useState } from "react";

interface CreateThreadModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { title: string; slug: string; domainPackId?: string }) => void;
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

  // Note: threads.listDomainPacks is NOT on the edge router (filesystem-dependent).
  // Domain pack selection is unavailable on the edge app.
  const domainPacks: { id: string; name: string; warnings: string[] }[] = [];

  const selectedPack = domainPacks.find((p) => p.id === domainPackId);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] p-6 shadow-xl">
        <h2 className="font-serif text-lg text-[#E8E4DF]">
          New Research Thread
        </h2>
        <p className="mt-1 text-xs text-[#8A8580]">
          Thread creation requires the full OODA app (filesystem access needed).
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium text-[#8A8580]">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Improve Sleep Quality"
              className="mt-1 w-full rounded-[3px] border border-[#2A2A2F] bg-[#111113] px-3 py-2 text-sm text-[#E8E4DF] placeholder-[#5A5855] outline-none focus:border-[#D4A04A]"
              autoFocus
            />
            {title && (
              <div className="mt-1 font-mono text-xs text-[#5A5855]">
                slug: {slugify(title)}
              </div>
            )}
          </div>

          {/* Domain Pack (optional -- unavailable on edge) */}
          <div>
            <label className="text-sm font-medium text-[#8A8580]">
              Domain Pack{" "}
              <span className="font-normal text-[#5A5855]">(unavailable on edge)</span>
            </label>
            <select
              value={domainPackId}
              onChange={(e) => setDomainPackId(e.target.value)}
              disabled
              className="mt-1 w-full rounded-[3px] border border-[#2A2A2F] bg-[#111113] px-3 py-2 text-sm text-[#E8E4DF] outline-none opacity-50 focus:border-[#D4A04A]"
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
              className="rounded-[3px] border border-[#2A2A2F] px-4 py-2 text-sm text-[#8A8580] transition-colors hover:text-[#E8E4DF]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-[3px] bg-[#D4A04A] px-4 py-2 text-sm font-medium text-[#111113] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
