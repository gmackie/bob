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
  const responseListener = useRef<EventSubscription | null>(null);

  useEffect(() => {
    // Request permissions
    void Notifications.requestPermissionsAsync();

    // Handle notification taps — navigate to explore screen
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const threadId = response.notification.request.content.data?.threadId;
        if (typeof threadId === "string" && threadId) {
          router.push({
            pathname: "/thread/[id]",
            params: { id: threadId, section: "explorations" },
          });
        } else {
          router.push("/explore");
        }
      });

    return () => {
      responseListener.current?.remove();
    };
  }, [router]);
}
