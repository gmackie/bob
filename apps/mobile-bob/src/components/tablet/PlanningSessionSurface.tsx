import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import type { ServerEvent } from "@bob/ws";

import {
  getPlanExecutionLayout,
  getPlanPanelMode,
} from "~/features/planning/plan-execution";
import type { PlanRunWatchTarget } from "~/features/planning/plan-execution";
import type { GatewaySession } from "~/hooks/use-gateway";
import { colors } from "~/lib/colors";

import { PlanExecutionPanel } from "./PlanExecutionPanel";
import { PlanRunWatch } from "./PlanRunWatch";
import { PlanningPane } from "./PlanningPane";

export function PlanningSessionSurface({
  sessionId,
  sessionStatus,
  sessionType,
  workItemTitle,
  events,
  sessions,
  onSendInput,
  onStopSession,
  onShowArtifact,
  onWatchRun,
  onReturnToPlan,
  onApprove,
}: {
  sessionId: string;
  sessionStatus: string;
  sessionType: string | null;
  workItemTitle: string;
  events: ServerEvent[];
  sessions: readonly GatewaySession[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
  onShowArtifact?: (content: string) => void;
  onWatchRun: (sessionId: string) => void;
  onReturnToPlan: () => void;
  onApprove: (sessionId: string, requestId: string, decision: "allow" | "deny") => void;
}) {
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const [watchByPlan, setWatchByPlan] = useState<{
    planId: string;
    run: PlanRunWatchTarget;
  } | null>(null);
  const mode = getPlanPanelMode(getPlanExecutionLayout(width), expanded);
  const watching = watchByPlan?.planId === sessionId ? watchByPlan.run : null;

  const watchRun = (run: PlanRunWatchTarget) => {
    setWatchByPlan({ planId: sessionId, run });
    if (watching?.sessionId === run.sessionId) return;
    onWatchRun(run.sessionId);
  };

  const returnToPlan = () => {
    setWatchByPlan(null);
    onReturnToPlan();
  };

  const panel = (
    <PlanExecutionPanel
      sessionId={sessionId}
      sessions={sessions}
      presentation={mode}
      onToggle={() => setExpanded((open) => !open)}
      onOpenRun={watchRun}
    />
  );

  const chat = watching ? (
    <PlanRunWatch
      run={watching}
      events={events}
      onBack={returnToPlan}
      onSendInput={onSendInput}
      onStopSession={onStopSession}
      onApprove={(requestId, decision) => onApprove(watching.sessionId, requestId, decision)}
    />
  ) : (
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
