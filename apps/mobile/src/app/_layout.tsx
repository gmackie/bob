import { useState, useCallback } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "~/utils/api";
import { Providers } from "../providers";
import { TabletSidebar } from "~/components/tablet/TabletSidebar";
import { AgentThreadView } from "~/components/tablet/AgentThreadView";
import { WorkItemPane } from "~/components/tablet/WorkItemPane";
import { PlanningPane } from "~/components/tablet/PlanningPane";
import { InspectorPanel } from "~/components/tablet/InspectorPanel";
import { useGateway } from "~/hooks/use-gateway";

import "../styles.css";

/**
 * Conditionally import SplitView — only available on iOS and only
 * meaningful on iPad. On iPhone or non-iOS platforms we fall back to Stack.
 */
let SplitView: typeof import("expo-router/build/split-view").SplitView | null = null;
if (Platform.OS === "ios") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-router/build/split-view");
    SplitView = mod.SplitView;
  } catch {
    // SplitView not available — fall back to Stack
  }
}

const isTablet = Platform.OS === "ios" && Platform.isPad;

const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: "#0B0F14" },
  animation: "fade" as const,
};

function PhoneLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}

function MainPane({
  gateway,
  onShowArtifact,
  onOpenInspector,
}: {
  gateway: ReturnType<typeof useGateway>;
  onShowArtifact: (content: string) => void;
  onOpenInspector: () => void;
}) {
  if (gateway.activePlanningSessionId && gateway.selectedSessionId) {
    return (
      <PlanningPane
        sessionId={gateway.activePlanningSessionId}
        sessionStatus="running"
        sessionType={null}
        workItemTitle=""
        events={gateway.selectedSessionEvents}
        onSendInput={gateway.sendInput}
        onStopSession={gateway.stopSession}
        onShowArtifact={onShowArtifact}
      />
    );
  }

  if (gateway.selectedSessionId) {
    return (
      <AgentThreadView
        sessionId={gateway.selectedSessionId}
        events={gateway.selectedSessionEvents}
        onSendInput={gateway.sendInput}
        onStopSession={gateway.stopSession}
      />
    );
  }

  if (gateway.selectedWorkItemId) {
    return (
      <WorkItemPane
        workItemId={gateway.selectedWorkItemId}
        onOpenSession={gateway.openPlanningSession}
        onOpenInspector={onOpenInspector}
      />
    );
  }

  return <Stack screenOptions={stackScreenOptions} />;
}

function TabletLayout() {
  const gateway = useGateway();
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [inspectorArtifact, setInspectorArtifact] = useState<string | null>(null);

  const handleShowArtifact = useCallback((content: string) => {
    setInspectorArtifact(content);
    setInspectorVisible(true);
  }, []);

  const handleOpenInspector = useCallback(() => {
    setInspectorVisible(true);
  }, []);

  if (!SplitView) {
    return <PhoneLayout />;
  }

  return (
    <SplitView>
      <SplitView.Column>
        <TabletSidebar
          sessions={gateway.sessions}
          connectionState={gateway.connectionState}
          selectedSessionId={gateway.selectedSessionId}
          selectedWorkItemId={gateway.selectedWorkItemId}
          onSelectSession={gateway.selectSession}
          onSelectWorkItem={gateway.selectWorkItem}
          onRefresh={gateway.refresh}
        />
      </SplitView.Column>
      <SplitView.Column>
        <View className="flex-1">
          <MainPane
            gateway={gateway}
            onShowArtifact={handleShowArtifact}
            onOpenInspector={handleOpenInspector}
          />
          <InspectorPanel
            visible={inspectorVisible}
            onClose={() => setInspectorVisible(false)}
            artifactContent={inspectorArtifact}
          />
        </View>
      </SplitView.Column>
    </SplitView>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Providers>
        {isTablet ? <TabletLayout /> : <PhoneLayout />}
        <StatusBar style="light" />
      </Providers>
    </QueryClientProvider>
  );
}
