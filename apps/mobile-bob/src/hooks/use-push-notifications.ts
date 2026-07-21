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

import { getNotificationTargetHref } from "~/features/planning/navigation";
import { createMobileBobRpcClient } from "~/utils/api";

// `PermissionStatus.GRANTED`'s runtime value, typed as the real enum via a
// type-only cast. We deliberately don't take a value import of
// `expo-notifications` (see the lazy `require()` load below), so we can't
// reference `PermissionStatus.GRANTED` directly — this keeps the comparison
// enum-typed instead of comparing against a bare string literal.
const PERMISSION_STATUS_GRANTED = "granted" as ExpoNotifications.PermissionStatus;

// Lazy-load expo-notifications to avoid crash if native module isn't available
let Notifications: typeof ExpoNotifications | null = null;
let Device: typeof ExpoDevice | null = null;

try {
  // This must stay a synchronous require() inside try/catch to defensively
  // handle a native module that may not be linked (Expo Go, some dev-client
  // builds). A static ESM import is hoisted and can't be try/caught, and
  // Metro/Babel transpiles it to the same require() call anyway, so switching
  // loses the crash guard this code exists for without buying any real ESM
  // behavior.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
  const loadedNotifications = require("expo-notifications") as typeof ExpoNotifications;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
  const loadedDevice = require("expo-device") as typeof ExpoDevice;
  Notifications = loadedNotifications;
  Device = loadedDevice;

  // Configure how notifications appear when the app is in foreground
  loadedNotifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
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

  if (!Device.isDevice) {
    console.log("[push] Must use physical device for push notifications");
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== PERMISSION_STATUS_GRANTED) {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== PERMISSION_STATUS_GRANTED) {
    console.log("[push] Permission not granted");
    return null;
  }

  // Get Expo push token.
  // `expoConfig.extra` is a genuinely open bag (arbitrary app.json/app.config
  // content) and the legacy `easConfig` field is untyped, so narrow both
  // explicitly rather than propagating `any`.
  const extraEasProjectId: unknown = (
    Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined
  )?.eas?.projectId;
  const legacyEasProjectId: unknown = (
    Constants as unknown as { easConfig?: { projectId?: unknown } }
  ).easConfig?.projectId;
  const projectId =
    (typeof extraEasProjectId === "string" ? extraEasProjectId : undefined) ??
    (typeof legacyEasProjectId === "string" ? legacyEasProjectId : undefined);
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
 * Uses the Bob Effect-RPC client since this runs outside React Query.
 */
async function registerTokenWithServer(token: string): Promise<void> {
  // `registerTokenWithServer` is only ever invoked with a real token, which
  // `registerForPushNotifications` only returns after confirming `Device` is
  // non-null (see its early `!Device` guard). TS can't track that invariant
  // across the async `.then()` boundary in a different function, so guard
  // explicitly instead of using `Device!`.
  if (!Device) {
    console.error(
      "[push] registerTokenWithServer called without Device being initialized",
    );
    return;
  }
  const device = Device;

  try {
    await createMobileBobRpcClient().workItems.notification.registerPushToken({
      token,
      platform: Platform.OS as "ios" | "android" | "web",
      deviceName: device.deviceName ?? "Unknown",
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
    workspaceId?: string;
    url?: string;
    type?: string;
  };

  const targetHref = getNotificationTargetHref(data);
  if (targetHref) {
    router.push(targetHref as never);
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
    void registerForPushNotifications().then((token) => {
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
