import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "~/utils/api";

import "../styles.css";

let SplitView: any = null;
if (Platform.OS === "ios") {
  try {
    const mod = require("expo-router/build/split-view");
    SplitView = mod.SplitView;
  } catch {}
}

const isTablet = Platform.OS === "ios" && Platform.isPad;

const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: "#111113" },
  animation: "fade" as const,
};

function PhoneLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}

function TabletLayout() {
  if (!SplitView) return <PhoneLayout />;

  return (
    <SplitView>
      <SplitView.Column>
        <View className="flex-1 bg-background border-r border-border">
          <Stack screenOptions={stackScreenOptions} />
        </View>
      </SplitView.Column>
      <SplitView.Column>
        <View className="flex-1 bg-background">
          <Stack screenOptions={stackScreenOptions} />
        </View>
      </SplitView.Column>
    </SplitView>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      {isTablet ? <TabletLayout /> : <PhoneLayout />}
      <StatusBar style="light" />
    </QueryClientProvider>
  );
}
