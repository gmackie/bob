"use client";

import { ErrorBoundary } from "@gmacko/core/ui/error-boundary";

import { LinearProgress } from "./linear-progress";
import { PendingApproval } from "./pending-approval";
import { ProviderCapacityCards } from "./provider-capacity-cards";
import { RunningNowRail } from "./running-now-rail";
import { WorkPipeline } from "./work-pipeline";
import { getMissionControlSections } from "./mission-control-model";

interface MissionControlProps {
  workspaceId?: string;
}

// Each panel gets its own ErrorBoundary so a throw in one (e.g. an unexpected
// data shape from a tRPC query) degrades to a localized "failed to load" card
// with a retry — instead of unmounting the whole /tasks page to a blank screen.
// This is the durable guard behind the pending-approval.tsx incident note.
export function MissionControl({ workspaceId }: MissionControlProps) {
  const sections = getMissionControlSections();

  return (
    <div className="flex flex-col gap-5">
      {/* Top billing: the "needs you" approvals. Self-hides when none are
          pending, so it only ever appears to demand action. */}
      <ErrorBoundary section="Pending approvals">
        <PendingApproval workspaceId={workspaceId} />
      </ErrorBoundary>

      {sections.includes("provider-capacity") ? (
        <ErrorBoundary section="Provider capacity">
          <ProviderCapacityCards workspaceId={workspaceId} />
        </ErrorBoundary>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {workspaceId && sections.includes("work-pipeline") ? (
            <ErrorBoundary section="Work pipeline">
              <WorkPipeline workspaceId={workspaceId} />
            </ErrorBoundary>
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          {workspaceId ? (
            <ErrorBoundary section="Linear progress">
              {/* Self-hides when the workspace has no Linear-synced issues. */}
              <LinearProgress workspaceId={workspaceId} />
            </ErrorBoundary>
          ) : null}
          {sections.includes("running-now") ? (
            <ErrorBoundary section="Running now">
              <RunningNowRail workspaceId={workspaceId} />
            </ErrorBoundary>
          ) : null}
        </div>
      </div>
    </div>
  );
}
