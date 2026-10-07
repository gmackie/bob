import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import type { ServerEvent } from "@bob/ws";

import {
  getPlanExecutionLayout,
  getPlanPanelMode,
} from "~/features/planning/plan-execution";
import { getTabletSessionHref } from "~/features/tablet/navigation";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";

import { PlanExecutionPanel } from "./PlanExecutionPanel";
import { PlanningPane } from "./PlanningPane";

export function PlanningSessionSurface({
  sessionId,
  sessionStatus,
  sessionType,
  workItemTitle,
  events,
  onSendInput,
  onStopSession,
  onShowArtifact,
}: {
  sessionId: string;
  sessionStatus: string;
  sessionType: string | null;
  workItemTitle: string;
  events: ServerEvent[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
  onShowArtifact?: (content: string) => void;
}) {
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const { sessions } = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const mode = getPlanPanelMode(getPlanExecutionLayout(width), expanded);

  const panel = (
    <PlanExecutionPanel
      sessionId={sessionId}
      sessions={sessions}
      presentation={mode}
      onToggle={() => setExpanded((open) => !open)}
      onOpenRun={(executionSessionId) => {
        router.push(getTabletSessionHref(executionSessionId, selectedWorkspaceId));
      }}
    />
  );

  const chat = (
    <PlanningPane
      sessionId={sessionId}
      sessionStatus={sessionStatus}
      sessionType={sessionType}
      workItemTitle={workItemTitle}
      events={events}
      onSendInput={onSendInput}
      onStopSession={onStopSession}
      onShowArtifact={onShowArtifact}
    />
  );

  if (mode === "column") {
    return (
      <View className="min-h-0 flex-1 flex-row">
        <View className="min-w-0 flex-1">{chat}</View>
        <View
          style={{
            width: 340,
            alignSelf: "stretch",
            borderLeftWidth: 1,
            borderLeftColor: colors.border,
          }}
        >
          {panel}
        </View>
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1">
      <View className="min-h-0 flex-1">{chat}</View>
      <View style={mode === "expanded" ? { flex: 1 } : undefined}>{panel}</View>
    </View>
  );
}
