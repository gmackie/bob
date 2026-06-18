import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import type { EventSubscription } from "expo-notifications";
import { useRouter } from "expo-router";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const router = useRouter();
  const responseListener = useRef<EventSubscription>();

  useEffect(() => {
    // Request permissions
    void Notifications.requestPermissionsAsync();

    // Handle notification taps — navigate to explore screen
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((_response) => {
        router.push("/explore");
      });

    return () => {
      responseListener.current?.remove();
    };
  }, [router]);
}
