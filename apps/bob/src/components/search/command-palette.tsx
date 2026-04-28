"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";

import { KIND_COLOR } from "~/lib/design/colors";
import { useTRPC } from "~/trpc/react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trpc = useTRPC();

  // Debounce search by 200ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setSearch("");
      setDebouncedSearch("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Get current workspace (cached across opens)
  const { data: workspaces } = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      enabled: open,
      staleTime: 60_000,
    }),
  );
  const workspaceId = (workspaces as any)?.[0]?.workspace?.id as
    | string
    | undefined;

  const searchEnabled =
    open && debouncedSearch.length >= 2 && !!workspaceId;

  const { data: results = [], isFetching } = useQuery(
    trpc.planning.searchTasks.queryOptions(
      { workspaceId: workspaceId!, query: debouncedSearch, limit: 10 },
      { enabled: searchEnabled },
    ),
  );

  const handleSelect = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} />

      {/* Palette */}
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work items..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {debouncedSearch.length < 2 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type to search work items...
            </div>
          ) : isFetching ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            (results as any[]).map((item) => (
              <Link
                key={item.id}
                href={`/work-items/${item.id}`}
                onClick={handleSelect}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent"
              >
                <Badge
                  variant={KIND_COLOR[item.kind] ?? "default"}
                  className="shrink-0 px-1.5 py-0 text-[10px]"
                >
                  {item.kind}
                </Badge>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {item.identifier}
                </span>
                <span className="truncate text-foreground">{item.title}</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </>
  );
}
