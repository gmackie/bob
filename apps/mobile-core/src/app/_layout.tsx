import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "~/utils/api";
import { NotificationProvider } from "~/providers/notification-provider";
import { usePushNotifications } from "~/hooks/use-push-notifications";
import { colors } from "~/lib/colors";
import "../styles.css";

function NotificationSetup() {
  usePushNotifications();
  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <NotificationSetup />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        <StatusBar style="light" />
      </NotificationProvider>
    </QueryClientProvider>
  );
}
