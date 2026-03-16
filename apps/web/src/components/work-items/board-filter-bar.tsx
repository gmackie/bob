"use client";

import { useMemo, useState } from "react";

import { Badge } from "@bob/ui/badge";
import { Input } from "@bob/ui/input";

import { KIND_COLOR } from "~/lib/design/colors";

import type { WorkItemBoardItem } from "./work-item-board";
import { WorkItemBoard } from "./work-item-board";

interface BoardFilterBarProps {
  items: WorkItemBoardItem[];
  projects?: Array<{ id: string; key: string }>;
}

const KINDS = ["issue", "task", "epic"] as const;

export function FilterableBoard({ items, projects }: BoardFilterBarProps) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = items;

    if (kindFilter) {
      result = result.filter((item) => item.kind === kindFilter);
    }

    if (projectFilter) {
      result = result.filter(
        (item) => (item as any).projectId === projectFilter,
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.identifier.toLowerCase().includes(q),
      );
    }

    return result;
  }, [items, kindFilter, projectFilter, search]);

  const hasFilters = !!kindFilter || !!projectFilter || !!search.trim();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter items..."
          className="h-8 w-48 text-sm"
        />

        <div className="flex gap-1.5">
          {KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() =>
                setKindFilter((prev) => (prev === kind ? null : kind))
              }
              className="transition-opacity"
            >
              <Badge
                variant={KIND_COLOR[kind] ?? "default"}
                className={
                  kindFilter && kindFilter !== kind ? "opacity-35" : ""
                }
              >
                {kind}
              </Badge>
            </button>
          ))}
        </div>

        {projects && projects.length > 1 && (
          <div className="flex gap-1.5">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() =>
                  setProjectFilter((prev) =>
                    prev === p.id ? null : p.id,
                  )
                }
              >
                <Badge
                  variant="default"
                  className={
                    projectFilter && projectFilter !== p.id
                      ? "opacity-35"
                      : ""
                  }
                >
                  {p.key}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {hasFilters && (
          <button
            onClick={() => {
              setSearch("");
              setKindFilter(null);
              setProjectFilter(null);
            }}
            className="text-xs text-white/40 transition-colors hover:text-white/70"
          >
            Clear
          </button>
        )}
      </div>

      <WorkItemBoard items={filtered} />
    </div>
  );
}
