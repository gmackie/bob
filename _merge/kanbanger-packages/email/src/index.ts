export type {
  EmailConfig,
  SendEmailOptions,
  EmailResult,
} from "./server";

export interface EmailPreferences {
  marketing: boolean;
  productUpdates: boolean;
  activityAlerts: boolean;
  weeklyDigest: boolean;
}

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  marketing: true,
  productUpdates: true,
  activityAlerts: true,
  weeklyDigest: false,
};

export const EMAIL_PREFERENCE_LABELS: Record<keyof EmailPreferences, string> = {
  marketing: "Marketing & Promotions",
  productUpdates: "Product Updates",
  activityAlerts: "Activity Alerts",
  weeklyDigest: "Weekly Digest",
};
