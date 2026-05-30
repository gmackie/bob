type EmailProvider = "resend" | "sendgrid" | "none";
type RealtimeProvider = "pusher" | "ably" | "none";
type StorageProvider = "uploadthing" | "none";

function readEnv(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value !== "");
}

function readBooleanEnv(
  name: string,
  values: Array<string | undefined>,
  defaultValue = false,
): boolean {
  const value = readEnv(...values);

  if (value === undefined) {
    return defaultValue;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new Error(
    `Invalid ${name}: expected "true", "false", "1", or "0".`,
  );
}

function readProviderEnv<TProvider extends string>(
  name: string,
  values: Array<string | undefined>,
  providers: readonly TProvider[],
  defaultValue: TProvider,
): TProvider {
  const value = readEnv(...values);

  if (value === undefined) {
    return defaultValue;
  }

  if (providers.includes(value as TProvider)) {
    return value as TProvider;
  }

  const providersList = providers
    .map((provider) => `"${provider}"`)
    .join(", ");

  throw new Error(
    `Invalid ${name}: expected one of ${providersList}.`,
  );
}

function assertProviderConfigured(
  integrationName: string,
  enabled: boolean,
  provider: string,
): void {
  if (enabled && provider === "none") {
    throw new Error(
      `${integrationName} integration is enabled but provider is "none".`,
    );
  }
}

const emailProvider = readProviderEnv<EmailProvider>(
  "BOB_EMAIL_PROVIDER",
  [
    process.env.BOB_EMAIL_PROVIDER,
    process.env.NEXT_PUBLIC_BOB_EMAIL_PROVIDER,
    process.env.EXPO_PUBLIC_BOB_EMAIL_PROVIDER,
  ],
  ["resend", "sendgrid", "none"],
  "none",
);
const emailEnabled = readBooleanEnv("BOB_EMAIL_ENABLED", [
  process.env.BOB_EMAIL_ENABLED,
  process.env.NEXT_PUBLIC_BOB_EMAIL_ENABLED,
  process.env.EXPO_PUBLIC_BOB_EMAIL_ENABLED,
]);

const realtimeProvider = readProviderEnv<RealtimeProvider>(
  "BOB_REALTIME_PROVIDER",
  [
    process.env.BOB_REALTIME_PROVIDER,
    process.env.NEXT_PUBLIC_BOB_REALTIME_PROVIDER,
    process.env.EXPO_PUBLIC_BOB_REALTIME_PROVIDER,
  ],
  ["pusher", "ably", "none"],
  "none",
);
const realtimeEnabled = readBooleanEnv("BOB_REALTIME_ENABLED", [
  process.env.BOB_REALTIME_ENABLED,
  process.env.NEXT_PUBLIC_BOB_REALTIME_ENABLED,
  process.env.EXPO_PUBLIC_BOB_REALTIME_ENABLED,
]);

const storageProvider = readProviderEnv<StorageProvider>(
  "BOB_STORAGE_PROVIDER",
  [
    process.env.BOB_STORAGE_PROVIDER,
    process.env.NEXT_PUBLIC_BOB_STORAGE_PROVIDER,
    process.env.EXPO_PUBLIC_BOB_STORAGE_PROVIDER,
  ],
  ["uploadthing", "none"],
  "none",
);
const storageEnabled = readBooleanEnv("BOB_STORAGE_ENABLED", [
  process.env.BOB_STORAGE_ENABLED,
  process.env.NEXT_PUBLIC_BOB_STORAGE_ENABLED,
  process.env.EXPO_PUBLIC_BOB_STORAGE_ENABLED,
]);

assertProviderConfigured("Email", emailEnabled, emailProvider);
assertProviderConfigured("Realtime", realtimeEnabled, realtimeProvider);
assertProviderConfigured("Storage", storageEnabled, storageProvider);

export const integrations = {
  sentry: readBooleanEnv("BOB_SENTRY_ENABLED", [
    process.env.BOB_SENTRY_ENABLED,
    process.env.NEXT_PUBLIC_BOB_SENTRY_ENABLED,
    process.env.EXPO_PUBLIC_BOB_SENTRY_ENABLED,
  ]),
  posthog: readBooleanEnv("BOB_POSTHOG_ENABLED", [
    process.env.BOB_POSTHOG_ENABLED,
    process.env.NEXT_PUBLIC_BOB_POSTHOG_ENABLED,
    process.env.EXPO_PUBLIC_BOB_POSTHOG_ENABLED,
  ]),

  // Payments - Web (default OFF)
  stripe: readBooleanEnv("BOB_STRIPE_ENABLED", [
    process.env.BOB_STRIPE_ENABLED,
    process.env.NEXT_PUBLIC_BOB_STRIPE_ENABLED,
    process.env.EXPO_PUBLIC_BOB_STRIPE_ENABLED,
  ]),

  // Payments - Mobile (default OFF)
  revenuecat: readBooleanEnv("BOB_REVENUECAT_ENABLED", [
    process.env.BOB_REVENUECAT_ENABLED,
    process.env.NEXT_PUBLIC_BOB_REVENUECAT_ENABLED,
    process.env.EXPO_PUBLIC_BOB_REVENUECAT_ENABLED,
  ]),

  // Push Notifications (default OFF)
  notifications: readBooleanEnv("BOB_NOTIFICATIONS_ENABLED", [
    process.env.BOB_NOTIFICATIONS_ENABLED,
    process.env.NEXT_PUBLIC_BOB_NOTIFICATIONS_ENABLED,
    process.env.EXPO_PUBLIC_BOB_NOTIFICATIONS_ENABLED,
  ]),

  // Communication (default OFF)
  email: {
    enabled: emailEnabled,
    provider: emailProvider,
  },

  // Realtime (default OFF)
  realtime: {
    enabled: realtimeEnabled,
    provider: realtimeProvider,
  },

  // Storage (default OFF)
  storage: {
    enabled: storageEnabled,
    provider: storageProvider,
  },

  // Internationalization (default OFF)
  i18n: readBooleanEnv("BOB_I18N_ENABLED", [
    process.env.BOB_I18N_ENABLED,
    process.env.NEXT_PUBLIC_BOB_I18N_ENABLED,
    process.env.EXPO_PUBLIC_BOB_I18N_ENABLED,
  ]),

  // OpenAPI documentation (default OFF)
  openapi: readBooleanEnv("BOB_OPENAPI_ENABLED", [
    process.env.BOB_OPENAPI_ENABLED,
    process.env.NEXT_PUBLIC_BOB_OPENAPI_ENABLED,
    process.env.EXPO_PUBLIC_BOB_OPENAPI_ENABLED,
  ]),
} as const;

export type Integrations = typeof integrations;

export const isSentryEnabled = () => integrations.sentry;
export const isPostHogEnabled = () => integrations.posthog;
export const isStripeEnabled = () => integrations.stripe;
export const isRevenueCatEnabled = () => integrations.revenuecat;
export const isNotificationsEnabled = () => integrations.notifications;
export const isEmailEnabled = () => integrations.email.enabled;
export const isRealtimeEnabled = () => integrations.realtime.enabled;
export const isStorageEnabled = () => integrations.storage.enabled;
export const isI18nEnabled = () => integrations.i18n;
export const isOpenApiEnabled = () => integrations.openapi;
