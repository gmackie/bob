"use client";

import { useState } from "react";

import { cn } from "@bob/ui";

interface StageProps {
  workItemId: string;
  workItem: {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    identifier: string;
  };
  isCurrentStage: boolean;
  isCompleted: boolean;
}

export function StageIdea({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
}: StageProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;

  return (
    <section
      id="stage-idea"
      className="rounded-3xl border border-border bg-card p-6"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => isCompleted && setCollapsed((c) => !c)}
        className={cn(
          "flex w-full items-center gap-3",
          isCompleted && "cursor-pointer",
        )}
      >
        <h2 className="font-display text-lg font-semibold text-foreground">
          Idea
        </h2>

        {isCompleted && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 6L5 8.5L9.5 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {isCompleted && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              "ml-auto text-muted-foreground transition-transform",
              isCollapsed && "-rotate-90",
            )}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="mt-4 space-y-4">
          {/* Kind badge + identifier */}
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {workItem.kind}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {workItem.identifier}
            </span>
          </div>

          {/* Title */}
          <h3 className="font-display text-xl font-bold text-foreground">
            {workItem.title}
          </h3>

          {/* Description */}
          {workItem.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {workItem.description}
            </p>
          ) : (
            isCurrentStage && (
              <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                This is just an idea. Shape it into something actionable.
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}
