import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { PermissionStatus } from "expo-notifications";

import { integrations } from "@bob/config";

export interface NotificationConfig {
  projectId?: string;
}

export type NotificationPayload = Record<string, unknown>;
export const workItemNotificationKinds = [
  "work_item_assigned",
  "work_item_commented",
  "work_item_needs_input",
  "work_item_review_ready",
] as const;
export type WorkItemNotificationKind =
  (typeof workItemNotificationKinds)[number];

export interface WorkItemNotificationPayload extends NotificationPayload {
  workItemId: string;
  kind: WorkItemNotificationKind;
  workspaceId?: string;
  projectId?: string;
}

interface LocalNotificationScheduleOptions {
  trigger?: Notifications.NotificationTriggerInput;
  data?: NotificationPayload;
}

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
});

export async function registerForPushNotifications(
  config?: NotificationConfig,
): Promise<string | null> {
  if (!integrations.notifications) {
    return null;
  }

  if (!Device.isDevice) {
    console.warn("Push notifications only work on physical devices");
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== PermissionStatus.GRANTED) {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== PermissionStatus.GRANTED) {
    console.warn("Push notification permission not granted");
    return null;
  }

  const easExtra: unknown = Constants.expoConfig?.extra?.eas;
  const extraProjectId =
    typeof easExtra === "object" &&
    easExtra !== null &&
    "projectId" in easExtra &&
    typeof easExtra.projectId === "string"
      ? easExtra.projectId
      : undefined;

  const projectId =
    config?.projectId ?? extraProjectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    console.error("No project ID found for push notifications");
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (error) {
    console.error("Failed to get push token:", error);
    return null;
  }
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  options: LocalNotificationScheduleOptions = {},
): Promise<string | null> {
  if (!integrations.notifications) {
    return null;
  }

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        ...(options.data ? { data: options.data } : {}),
      },
      trigger: options.trigger ?? null,
    });
  } catch (error) {
    console.error("Failed to schedule notification:", error);
    return null;
  }
}

export async function cancelNotification(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseReceivedListener(
  callback: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

export function useLastNotificationResponse() {
  return Notifications.useLastNotificationResponse();
}

export function createWorkItemNotificationPayload(input: {
  workItemId: string;
  kind: WorkItemNotificationKind;
  workspaceId?: string;
  projectId?: string;
  data?: NotificationPayload;
}): WorkItemNotificationPayload {
  return {
    ...(input.data ?? {}),
    workItemId: input.workItemId,
    kind: input.kind,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  };
}

export { Notifications };
