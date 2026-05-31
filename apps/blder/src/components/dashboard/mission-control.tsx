"use client";

import { ActivityFeed } from "./activity-feed";
import { AgentStatusBar } from "./agent-status-bar";
import { AttentionPanel } from "./attention-panel";
import { ProjectProgress } from "./project-progress";
import { RecentRuns } from "./recent-runs";
import { SkillUsage } from "./skill-usage";

interface MissionControlProps {
  workspaceId?: string;
}

export function MissionControl({ workspaceId }: MissionControlProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Agent status bar — full width */}
      <AgentStatusBar />

      {/* 3-column grid */}
      <div className="grid grid-cols-[16rem_1fr_18rem] gap-5">
        {/* Left column — Project progress */}
        <ProjectProgress workspaceId={workspaceId ?? ""} />

        {/* Center column — Activity feed */}
        <ActivityFeed workspaceId={workspaceId} />

        {/* Right column — Recent runs + Attention + Skill usage */}
        <div className="flex flex-col gap-5">
          <RecentRuns workspaceId={workspaceId ?? ""} />
          <AttentionPanel workspaceId={workspaceId} />
          <SkillUsage />
        </div>
      </div>
    </div>
  );
}
