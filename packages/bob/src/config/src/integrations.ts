export const integrations = {
  sentry: false as boolean,
  posthog: false as boolean,

  // Payments - Web (default OFF)
  stripe: false as boolean,

  // Payments - Mobile (default OFF)
  revenuecat: false as boolean,

  // Push Notifications (default OFF)
  notifications: false as boolean,

  // Communication (default OFF)
  email: {
    enabled: false,
    provider: "none" as "resend" | "sendgrid" | "none",
  },

  // Realtime (default OFF)
  realtime: {
    enabled: false,
    provider: "none" as "pusher" | "ably" | "none",
  },

  // Storage (default OFF)
  storage: {
    enabled: false,
    provider: "none" as "uploadthing" | "none",
  },

  // Internationalization (default OFF)
  i18n: false,

  // OpenAPI documentation (default ON)
  openapi: true as boolean,
} as const;

export type Integrations = typeof integrations;

export const isSentryEnabled = () =>
  [
    process.env.SENTRY_DSN,
    process.env.NEXT_PUBLIC_SENTRY_DSN,
    process.env.EXPO_PUBLIC_SENTRY_DSN,
  ].some((v) => Boolean(v?.trim()));
export const isPostHogEnabled = () =>
  [
    process.env.POSTHOG_KEY,
    process.env.NEXT_PUBLIC_POSTHOG_KEY,
    process.env.EXPO_PUBLIC_POSTHOG_KEY,
  ].some((v) => Boolean(v?.trim()));
export const isStripeEnabled = () => integrations.stripe;
export const isRevenueCatEnabled = () => integrations.revenuecat;
export const isNotificationsEnabled = () => integrations.notifications;
export const isEmailEnabled = () => integrations.email.enabled;
export const isRealtimeEnabled = () => integrations.realtime.enabled;
export const isStorageEnabled = () => integrations.storage.enabled;
export const isI18nEnabled = () => integrations.i18n;
export const isOpenApiEnabled = () => integrations.openapi;
