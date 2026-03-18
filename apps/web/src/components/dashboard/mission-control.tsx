"use client";

import { AgentStatusBar } from "./agent-status-bar";

export function MissionControl() {
  return (
    <div className="flex flex-col gap-5">
      {/* Agent status bar — full width */}
      <AgentStatusBar />

      {/* 3-column grid */}
      <div className="grid grid-cols-[16rem_1fr_18rem] gap-5">
        {/* Left column — Project progress */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Projects
          </h3>
          <p className="mt-3 font-body text-sm text-muted-foreground">
            No projects to display
          </p>
        </div>

        {/* Center column — Activity feed */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Recent Activity
          </h3>
          <p className="mt-3 font-body text-sm text-muted-foreground">
            No recent activity
          </p>
        </div>

        {/* Right column — Attention items */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Needs Attention
          </h3>
          <p className="mt-3 font-body text-sm text-muted-foreground">
            Nothing needs attention right now
          </p>
        </div>
      </div>
    </div>
  );
}
