export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  data?: Record<string, unknown>;
  createdAt: Date;
}

export type NotificationType =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "activity"
  | "system";

export interface NotificationPreferences {
  pushEnabled: boolean;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  types: {
    activity: boolean;
    system: boolean;
    marketing: boolean;
  };
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  inAppEnabled: true,
  emailEnabled: true,
  types: {
    activity: true,
    system: true,
    marketing: false,
  },
};

export interface PushToken {
  token: string;
  platform: "ios" | "android" | "web";
  createdAt: Date;
}
