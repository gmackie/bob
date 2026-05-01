"use client";

import { useState } from "react";

import { cn } from "@gmacko/core/ui";

import { RequirementsChecklist } from "~/components/work-items/requirements-checklist";
import { SessionHistory } from "./session-history";

interface StageShapeProps {
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
  requirementCount: number;
}

export function StageShape({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
  requirementCount,
}: StageShapeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;
  const showChecklist = workItem.kind === "epic" || workItem.kind === "issue";

  return (
    <section
      id="stage-shape"
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
          Shape
        </h2>

        {requirementCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {requirementCount} requirement{requirementCount !== 1 ? "s" : ""}
          </span>
        )}

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
        <div className="mt-4">
          {showChecklist ? (
            <RequirementsChecklist
              workItemId={workItemId}
              workItemKind={workItem.kind}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Requirements are only available for epics and issues.
            </div>
          )}

          <SessionHistory
            workItemId={workItemId}
            sessionTypes={["office_hours"]}
            className="mt-4"
          />
        </div>
      )}
    </section>
  );
}
