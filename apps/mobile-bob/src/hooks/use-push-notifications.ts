/**
 * Push notification registration and handling for Bob mobile.
 *
 * Registers the device's push token with the server on app launch,
 * handles incoming notifications, and provides navigation to the
 * relevant work item when a notification is tapped.
 */

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import type * as ExpoNotifications from "expo-notifications";
import type * as ExpoDevice from "expo-device";

import { getBaseUrl } from "~/utils/base-url";

// Lazy-load expo-notifications to avoid crash if native module isn't available
let Notifications: typeof ExpoNotifications | null = null;
let Device: typeof ExpoDevice | null = null;

try {
  Notifications = require("expo-notifications");
  Device = require("expo-device");

  // Configure how notifications appear when the app is in foreground
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  console.log("[push] expo-notifications not available (native module not linked)");
}

/**
 * Register for push notifications and return the Expo push token.
 */
async function registerForPushNotifications(): Promise<string | null> {
  if (!Notifications || !Device) {
    console.log("[push] Native modules not available, skipping registration");
    return null;
  }

  if (!Device!.isDevice) {
    console.log("[push] Must use physical device for push notifications");
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[push] Permission not granted");
    return null;
  }

  // Get Expo push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  if (!projectId) {
    console.log("[push] No EAS project ID found");
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log("[push] Token:", tokenData.data);
    return tokenData.data;
  } catch (error) {
    console.error("[push] Failed to get token:", error);
    return null;
  }
}

/**
 * Send the push token to the Bob server for storage.
 * Uses raw fetch since this runs outside the tRPC query context.
 */
async function registerTokenWithServer(token: string): Promise<void> {
  const baseUrl = getBaseUrl();
  try {
    await fetch(`${baseUrl}/api/trpc/notification.registerPushToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "0": {
          json: {
            token,
            platform: Platform.OS as "ios" | "android" | "web",
            deviceName: Device!.deviceName ?? "Unknown",
          },
        },
      }),
    });
    console.log("[push] Token registered with server");
  } catch (error) {
    console.error("[push] Failed to register token:", error);
  }
}

/**
 * Handle notification tap — navigate to the relevant screen.
 */
function handleNotificationResponse(
  response: ExpoNotifications.NotificationResponse,
): void {
  const data = response.notification.request.content.data as {
    workItemId?: string;
    url?: string;
    type?: string;
  };

  if (data.workItemId) {
    router.push(`/work-items/${data.workItemId}` as never);
  } else if (data.url) {
    router.push(data.url as never);
  }
}

/**
 * Hook to set up push notifications on app launch.
 * Call this once in the root layout.
 */
export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationListener = useRef<ExpoNotifications.EventSubscription | null>(null);
  const responseListener = useRef<ExpoNotifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!Notifications) return;

    // Register for push notifications
    registerForPushNotifications().then((token) => {
      if (token) {
        setExpoPushToken(token);
        void registerTokenWithServer(token);
      }
    });

    // Listen for incoming notifications (foreground)
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("[push] Received:", notification.request.content.title);
      },
    );

    // Listen for notification taps
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );

    // Set badge count
    void Notifications.setBadgeCountAsync(0);

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return { expoPushToken };
}
