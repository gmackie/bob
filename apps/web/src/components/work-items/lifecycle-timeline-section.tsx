"use client";

import { useState } from "react";

import { LifecycleTimeline } from "./lifecycle-timeline";

interface LifecycleTimelineSectionProps {
  workItemId: string;
}

export function LifecycleTimelineSection({
  workItemId,
}: LifecycleTimelineSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-3xl border border-border bg-secondary p-6">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="font-display text-lg font-semibold text-foreground">
          Lifecycle Events
        </h2>
        <span className="text-sm text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <LifecycleTimeline workItemId={workItemId} />
        </div>
      )}
    </section>
  );
}
