"use client";

import { ActiveDispatches } from "./active-dispatches";
import { ActivityFeed } from "./activity-feed";
import { AgentStatusBar } from "./agent-status-bar";
import { AttentionPanel } from "./attention-panel";
import { ProjectProgress } from "./project-progress";
import { SkillUsage } from "./skill-usage";
import { WorkPipeline } from "./work-pipeline";

interface MissionControlProps {
  workspaceId?: string;
}

export function MissionControl({ workspaceId }: MissionControlProps) {
  return (
    <div className="flex flex-col gap-5">
      <AgentStatusBar />

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {workspaceId ? <WorkPipeline workspaceId={workspaceId} /> : null}
          <ActivityFeed workspaceId={workspaceId} />
        </div>
        <div className="flex flex-col gap-5">
          <ProjectProgress workspaceId={workspaceId ?? ""} />
          <ActiveDispatches />
          <AttentionPanel />
          <SkillUsage />
        </div>
      </div>
    </div>
  );
}
