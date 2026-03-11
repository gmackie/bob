"use client";

import { Button } from "@linear-clone/ui/components/button";
import {
  X,
  Trash2,
  Archive,
  Circle,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import type { TaskStatus } from "./status-badge";
import type { TaskPriority } from "./priority-badge";
import { statusConfig } from "./status-badge";
import { priorityConfig } from "./priority-badge";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onStatusChange?: (status: TaskStatus) => void;
  onPriorityChange?: (priority: TaskPriority) => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

export function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onStatusChange,
  onPriorityChange,
  onArchive,
  onDelete,
}: BulkActionsBarProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 left-0 right-0 z-40 mx-auto w-fit">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 shadow-lg">
        <span className="text-sm font-medium">
          {selectedCount} selected
        </span>

        <div className="mx-2 h-4 w-px bg-border" />

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowStatusMenu(!showStatusMenu);
              setShowPriorityMenu(false);
            }}
          >
            <Circle className="mr-1 h-3.5 w-3.5" />
            Status
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
          {showStatusMenu && (
            <div className="absolute bottom-full left-0 mb-1 w-44 rounded-md border border-border bg-popover p-1 shadow-lg">
              {Object.entries(statusConfig).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onStatusChange?.(key as TaskStatus);
                    setShowStatusMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  {config.icon}
                  <span>{config.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowPriorityMenu(!showPriorityMenu);
              setShowStatusMenu(false);
            }}
          >
            Priority
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
          {showPriorityMenu && (
            <div className="absolute bottom-full left-0 mb-1 w-44 rounded-md border border-border bg-popover p-1 shadow-lg">
              {Object.entries(priorityConfig).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onPriorityChange?.(key as TaskPriority);
                    setShowPriorityMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  {config.icon}
                  <span>{config.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {onArchive && (
          <Button variant="ghost" size="sm" onClick={onArchive}>
            <Archive className="mr-1 h-3.5 w-3.5" />
            Archive
          </Button>
        )}

        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
        )}

        <div className="mx-2 h-4 w-px bg-border" />

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClearSelection}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
