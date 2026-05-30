export const integrations = {
  sentry: false,
  sentryFirstSync: false,
  posthog: false,
  forgegraph: false,
  cloudflare: false,
  twenty: false,
  quickbooks: false,

  // Payments - Web (default OFF)
  stripe: false,

  // Payments - Mobile (default OFF)
  revenuecat: false,

  // Push Notifications (default OFF)
  notifications: false,

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

  // OpenAPI documentation (default OFF)
  openapi: false,
} as const;

export type Integrations = typeof integrations;

export const isSentryEnabled = () => integrations.sentry;
export const isSentryFirstSyncComplete = () => integrations.sentryFirstSync;
export const isPostHogEnabled = () => integrations.posthog;
export const isForgeGraphEnabled = () => integrations.forgegraph;
export const isCloudflareEnabled = () => integrations.cloudflare;
export const isTwentyEnabled = () => integrations.twenty;
export const isQuickBooksEnabled = () => integrations.quickbooks;
export const isStripeEnabled = () => integrations.stripe;
export const isRevenueCatEnabled = () => integrations.revenuecat;
export const isNotificationsEnabled = () => integrations.notifications;
export const isEmailEnabled = () => integrations.email.enabled;
export const isRealtimeEnabled = () => integrations.realtime.enabled;
export const isStorageEnabled = () => integrations.storage.enabled;
export const isI18nEnabled = () => integrations.i18n;
export const isOpenApiEnabled = () => integrations.openapi;
