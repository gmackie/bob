export type IntegrationState =
  | "enabled"
  | "disabled"
  | "not_configured"
  | "incomplete"
  | "invalid"
  | "unsupported";

/** Safe to serialize. Configuration values must never enter this type. */
export interface IntegrationStatus {
  readonly provider: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly status: IntegrationState;
  readonly reason: string;
}

export type IntegrationId =
  | "sentry"
  | "posthog"
  | "stripe"
  | "revenuecat"
  | "notifications"
  | "email"
  | "realtime"
  | "storage";
export type IntegrationStatuses = Readonly<
  Record<IntegrationId, IntegrationStatus>
>;
export type IntegrationEnv = Readonly<Record<string, unknown>>;

export const integrationEnvKeys = [
  "BOB_SENTRY_ENABLED",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_SENTRY_DSN",
  "BOB_POSTHOG_ENABLED",
  "POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "EXPO_PUBLIC_POSTHOG_KEY",
  "POSTHOG_HOST",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "EXPO_PUBLIC_POSTHOG_HOST",
  "BOB_STRIPE_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PREMIUM",
  "STRIPE_PRICE_PRO",
  "GATEWAY_URL",
  "GATEWAY_PUBLIC_URL",
] as const;

interface Field {
  keys: readonly string[];
  valid: (value: string) => boolean;
  format: string;
  optional?: boolean;
}

function status(
  provider: string,
  name: string,
  state: IntegrationState,
  reason: string,
): IntegrationStatus {
  return Object.freeze({
    provider,
    name,
    enabled: state === "enabled",
    status: state,
    reason,
  });
}

function readField(env: IntegrationEnv, keys: readonly string[]) {
  for (const key of keys) {
    const raw = env[key];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value !== undefined && value !== null && value !== "")
      return { key, value };
  }
  return { key: keys[0] ?? "", value: undefined };
}

function isServiceUrl(value: string, protocols = ["https:", "http:"]): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      protocols.includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isSentryDsn(value: string): boolean {
  if (!/^https?:\/\/\w+@/.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !!url.hostname &&
      /^\w+$/.test(url.username) &&
      !url.password &&
      /\/\d+$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function validate(
  env: IntegrationEnv,
  provider: string,
  name: string,
  enabledKey: string | undefined,
  fields: readonly Field[],
  optIn = false,
): IntegrationStatus {
  const toggle = enabledKey ? readField(env, [enabledKey]).value : undefined;
  if (toggle !== undefined) {
    if (typeof toggle !== "string" || !/^(true|false|1|0)$/i.test(toggle)) {
      return status(
        provider,
        name,
        "invalid",
        `${enabledKey} must be true, false, 1 or 0.`,
      );
    }
    if (/^(false|0)$/i.test(toggle)) {
      return status(provider, name, "disabled", `Disabled by ${enabledKey}.`);
    }
  } else if (optIn) {
    return status(
      provider,
      name,
      "disabled",
      `Set ${enabledKey}=true to enable billing and paid-plan enforcement.`,
    );
  }

  const values = fields.map((field) => ({
    field,
    ...readField(env, field.keys),
  }));
  if (
    toggle === undefined &&
    values.every(({ value }) => value === undefined)
  ) {
    return status(
      provider,
      name,
      "not_configured",
      `Not configured. Set ${fields
        .filter((field) => !field.optional)
        .map((field) => field.keys[0])
        .join(", ")}.`,
    );
  }
  const invalid = values.filter(
    ({ field, value }) =>
      value !== undefined && (typeof value !== "string" || !field.valid(value)),
  );
  if (invalid.length) {
    return status(
      provider,
      name,
      "invalid",
      invalid.map(({ key, field }) => `${key} ${field.format}.`).join(" "),
    );
  }
  const missing = values.filter(
    ({ field, value }) => !field.optional && value === undefined,
  );
  if (missing.length) {
    return status(
      provider,
      name,
      "incomplete",
      `Missing ${missing.map(({ key }) => key).join(", ")}.`,
    );
  }
  return status(
    provider,
    name,
    "enabled",
    "Configuration is valid. Connectivity has not been checked.",
  );
}

/** Validate the config boundary without network calls, logging or retaining secrets. */
export function resolveIntegrationConfig(
  env: IntegrationEnv,
): IntegrationStatuses {
  let stripe = validate(
    env,
    "stripe",
    "Stripe",
    "BOB_STRIPE_ENABLED",
    [
      {
        keys: ["STRIPE_SECRET_KEY"],
        valid: (value) => /^(sk|rk)_(test|live)_[a-zA-Z0-9]+$/.test(value),
        format: "must be a Stripe secret or restricted API key",
      },
      {
        keys: ["STRIPE_WEBHOOK_SECRET"],
        valid: (value) => /^whsec_[a-zA-Z0-9]+$/.test(value),
        format: "must be a Stripe webhook signing secret",
      },
      {
        keys: ["STRIPE_PRICE_PREMIUM"],
        valid: (value) => /^price_[a-zA-Z0-9]+$/.test(value),
        format: "must be a Stripe price ID",
        optional: true,
      },
      {
        keys: ["STRIPE_PRICE_PRO"],
        valid: (value) => /^price_[a-zA-Z0-9]+$/.test(value),
        format: "must be a Stripe price ID",
        optional: true,
      },
    ],
    true,
  );
  const premiumPrice = readField(env, ["STRIPE_PRICE_PREMIUM"]).value;
  const proPrice = readField(env, ["STRIPE_PRICE_PRO"]).value;
  if (stripe.enabled && premiumPrice === undefined && proPrice === undefined) {
    stripe = status(
      "stripe",
      "Stripe",
      "incomplete",
      "Set STRIPE_PRICE_PREMIUM or STRIPE_PRICE_PRO to offer a paid plan.",
    );
  } else if (stripe.enabled && premiumPrice === proPrice) {
    stripe = status(
      "stripe",
      "Stripe",
      "invalid",
      "STRIPE_PRICE_PREMIUM and STRIPE_PRICE_PRO must be different price IDs.",
    );
  }
  return Object.freeze({
    sentry: validate(env, "sentry", "Sentry", "BOB_SENTRY_ENABLED", [
      {
        keys: [
          "SENTRY_DSN",
          "NEXT_PUBLIC_SENTRY_DSN",
          "EXPO_PUBLIC_SENTRY_DSN",
        ],
        valid: isSentryDsn,
        format:
          "must be an HTTP(S) Sentry DSN with a public key and numeric project ID",
      },
    ]),
    posthog: validate(env, "posthog", "PostHog", "BOB_POSTHOG_ENABLED", [
      {
        keys: [
          "POSTHOG_KEY",
          "NEXT_PUBLIC_POSTHOG_KEY",
          "EXPO_PUBLIC_POSTHOG_KEY",
        ],
        valid: (value) => /^phc_[a-zA-Z0-9_-]+$/.test(value),
        format: "must be a PostHog project key",
      },
      {
        keys: [
          "POSTHOG_HOST",
          "NEXT_PUBLIC_POSTHOG_HOST",
          "EXPO_PUBLIC_POSTHOG_HOST",
        ],
        valid: (value) => isServiceUrl(value),
        format: "must be an HTTP(S) URL without credentials, query or fragment",
        optional: true,
      },
    ]),
    stripe,
    realtime: validate(env, "gateway", "Realtime gateway", undefined, [
      {
        keys: ["GATEWAY_URL"],
        valid: (value) => isServiceUrl(value),
        format: "must be an HTTP(S) URL without credentials, query or fragment",
      },
      {
        keys: ["GATEWAY_PUBLIC_URL"],
        valid: (value) =>
          isServiceUrl(value, ["https:", "http:", "wss:", "ws:"]),
        format:
          "must be an HTTP(S) or WS(S) URL without credentials, query or fragment",
        optional: true,
      },
    ]),
    revenuecat: status(
      "revenuecat",
      "RevenueCat",
      "unsupported",
      "No RevenueCat adapter is installed.",
    ),
    notifications: status(
      "notifications",
      "Mobile notifications",
      "unsupported",
      "Push registration is configured in the mobile app.",
    ),
    email: status(
      "none",
      "Email",
      "unsupported",
      "No email delivery adapter is installed.",
    ),
    storage: status(
      "none",
      "Storage",
      "unsupported",
      "No external storage adapter is installed.",
    ),
  });
}

let runtimeStatuses: IntegrationStatuses | undefined;

/** Node startup or the Worker invocation supplies the current runtime bindings. */
export function initializeIntegrationConfig(
  env: IntegrationEnv = process.env,
): IntegrationStatuses {
  runtimeStatuses = resolveIntegrationConfig(env);
  return runtimeStatuses;
}

export function getIntegrationStatuses(): IntegrationStatuses {
  return runtimeStatuses ?? resolveIntegrationConfig(process.env);
}

/** Preserve existing callers while deriving availability from the same status metadata. */
export const integrations = {
  get sentry() {
    return getIntegrationStatuses().sentry.enabled;
  },
  get posthog() {
    return getIntegrationStatuses().posthog.enabled;
  },
  get stripe() {
    return getIntegrationStatuses().stripe.enabled;
  },
  get revenuecat() {
    return getIntegrationStatuses().revenuecat.enabled;
  },
  get notifications() {
    return getIntegrationStatuses().notifications.enabled;
  },
  email: {
    get enabled() {
      return getIntegrationStatuses().email.enabled;
    },
    provider: "none" as "resend" | "sendgrid" | "none",
  },
  realtime: {
    get enabled() {
      return getIntegrationStatuses().realtime.enabled;
    },
    get provider(): "gateway" | "pusher" | "ably" | "none" {
      return getIntegrationStatuses().realtime.enabled ? "gateway" : "none";
    },
  },
  storage: {
    get enabled() {
      return getIntegrationStatuses().storage.enabled;
    },
    provider: "none" as "uploadthing" | "none",
  },
  // Local feature switches, not external provider configuration.
  i18n: false,
  openapi: true as boolean,
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
