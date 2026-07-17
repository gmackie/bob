"use client";

import { PendingApproval } from "./pending-approval";
import { ProviderCapacityCards } from "./provider-capacity-cards";
import { RunningNowRail } from "./running-now-rail";
import { WorkPipeline } from "./work-pipeline";
import { getMissionControlSections } from "./mission-control-model";

interface MissionControlProps {
  workspaceId?: string;
}

export function MissionControl({ workspaceId }: MissionControlProps) {
  const sections = getMissionControlSections();

  return (
    <div className="flex flex-col gap-5">
      {/* Top billing: the "needs you" approvals. Self-hides when none are
          pending, so it only ever appears to demand action. */}
      <PendingApproval workspaceId={workspaceId} />

      {sections.includes("provider-capacity") ? (
        <ProviderCapacityCards workspaceId={workspaceId} />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {workspaceId && sections.includes("work-pipeline") ? (
            <WorkPipeline workspaceId={workspaceId} />
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          {sections.includes("running-now") ? (
            <RunningNowRail workspaceId={workspaceId} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
