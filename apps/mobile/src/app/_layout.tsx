import { Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "~/utils/api";
import { Providers } from "../providers";
import { TabletSidebar } from "~/components/tablet/TabletSidebar";
import { AgentThreadView } from "~/components/tablet/AgentThreadView";
import { useGateway } from "~/hooks/use-gateway";

import "../styles.css";

// Push notifications disabled until next EAS build includes expo-notifications native module.
// Re-enable by importing usePushNotifications and calling it in AppContent.
// import { usePushNotifications } from "~/hooks/use-push-notifications";

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

function TabletLayout() {
  const gateway = useGateway();

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
          onSelectSession={gateway.selectSession}
          onRefresh={gateway.refresh}
        />
      </SplitView.Column>
      <SplitView.Column>
        {gateway.selectedSessionId ? (
          <AgentThreadView
            sessionId={gateway.selectedSessionId}
            events={gateway.selectedSessionEvents}
            onSendInput={gateway.sendInput}
            onStopSession={gateway.stopSession}
          />
        ) : (
          <Stack screenOptions={stackScreenOptions} />
        )}
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
