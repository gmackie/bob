import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "~/utils/api";
import { Providers } from "../providers";
import { usePushNotifications } from "~/hooks/use-push-notifications";

import "../styles.css";

function AppContent() {
  // Register for push notifications on mount
  usePushNotifications();

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: "#0B0F14",
          },
          animation: "fade",
        }}
      />
      <StatusBar style="light" />
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Providers>
        <AppContent />
      </Providers>
    </QueryClientProvider>
  );
}
