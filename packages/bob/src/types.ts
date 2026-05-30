export interface IntegrationConfig {
  sentry: boolean;
  sentryFirstSync: boolean;
  posthog: boolean;
  forgegraph: boolean;
  cloudflare: boolean;
  twenty: boolean;
  quickbooks: boolean;
  stripe: boolean;
  revenuecat: boolean;
  notifications: boolean;
  email: { enabled: boolean; provider: "resend" | "sendgrid" | "none" };
  realtime: { enabled: boolean; provider: "pusher" | "ably" | "none" };
  storage: { enabled: boolean; provider: "uploadthing" | "none" };
}

export interface PlatformConfig {
  web: boolean;
  mobile: boolean;
  tanstackStart: boolean;
}

export interface CliOptions {
  appName: string;
  displayName: string;
  packageScope: string;
  platforms: PlatformConfig;
  integrations: IntegrationConfig;
  includeAi: boolean;
  includeProvision: boolean;
  prune: boolean;
  install: boolean;
  git: boolean;
}

export type IntegrationPreset =
  | "core"
  | "recommended"
  | "everything"
  | "custom";

export const DEFAULT_INTEGRATIONS: IntegrationConfig = {
  sentry: true,
  sentryFirstSync: false,
  posthog: true,
  forgegraph: false,
  cloudflare: false,
  twenty: false,
  quickbooks: false,
  stripe: false,
  revenuecat: false,
  notifications: false,
  email: { enabled: false, provider: "none" },
  realtime: { enabled: false, provider: "none" },
  storage: { enabled: false, provider: "none" },
};

export const CORE_INTEGRATIONS: IntegrationConfig = {
  sentry: false,
  sentryFirstSync: false,
  posthog: false,
  forgegraph: false,
  cloudflare: false,
  twenty: false,
  quickbooks: false,
  stripe: false,
  revenuecat: false,
  notifications: false,
  email: { enabled: false, provider: "none" },
  realtime: { enabled: false, provider: "none" },
  storage: { enabled: false, provider: "none" },
};

export const EVERYTHING_INTEGRATIONS: IntegrationConfig = {
  sentry: true,
  sentryFirstSync: true,
  posthog: true,
  forgegraph: true,
  cloudflare: true,
  twenty: true,
  quickbooks: true,
  stripe: true,
  revenuecat: true,
  notifications: true,
  email: { enabled: true, provider: "resend" },
  realtime: { enabled: true, provider: "pusher" },
  storage: { enabled: true, provider: "uploadthing" },
};

export const BIZPULSE_INTEGRATIONS: IntegrationConfig = {
  ...DEFAULT_INTEGRATIONS,
  sentryFirstSync: true,
  forgegraph: true,
  cloudflare: true,
  twenty: true,
  quickbooks: true,
};
