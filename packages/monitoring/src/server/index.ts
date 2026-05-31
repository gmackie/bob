import { integrations } from "@bob/config";

export interface ObservabilityConfig {
  serviceName: string;
  environment?: string;
  release?: string;
  sentryDsn?: string;
  tracesSampleRate?: number;
  posthogKey?: string;
  posthogHost?: string;
}

export interface ObservabilityContext {
  userId?: string | null;
  userEmail?: string | null;
  tenantId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  serviceName?: string;
  operation?: string;
  route?: string;
  [key: string]: unknown;
}

let initialized = false;
let serviceName = "bob";
let environment: string = process.env.NODE_ENV ?? "development";
let release = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA;
let posthogKey: string | undefined;
let posthogHost = "https://us.i.posthog.com";

function detectEnvironment(): string {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV === "preview"
      ? "staging"
      : process.env.VERCEL_ENV;
  }
  return process.env.NODE_ENV ?? "development";
}

function getSentryDsn(config?: ObservabilityConfig): string | undefined {
  return config?.sentryDsn ?? process.env.SENTRY_DSN;
}

function getPostHogKey(config?: ObservabilityConfig): string | undefined {
  return (
    config?.posthogKey ??
    process.env.POSTHOG_KEY ??
    process.env.POSTHOG_PROJECT_API_KEY ??
    process.env.NEXT_PUBLIC_POSTHOG_KEY
  );
}

function cleanContext(
  context?: ObservabilityContext,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(context ?? {}).filter(
      (entry): entry is [string, string | number | boolean] => {
        const value = entry[1];
        return (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        );
      },
    ),
  );
}

export async function initObservability(
  config: ObservabilityConfig,
): Promise<void> {
  serviceName = config.serviceName;
  environment = config.environment ?? detectEnvironment();
  release = config.release ?? release;
  posthogKey = getPostHogKey(config);
  posthogHost = config.posthogHost ?? process.env.POSTHOG_HOST ?? posthogHost;

  if (initialized) {
    return;
  }
  initialized = true;

  const sentryDsn = getSentryDsn(config);
  if (integrations.sentry && sentryDsn) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: sentryDsn,
      environment,
      release,
      serverName: serviceName,
      tracesSampleRate:
        config.tracesSampleRate ?? (environment === "production" ? 0.1 : 1),
    });
  }
}

export async function setObservabilityContext(
  context: ObservabilityContext,
): Promise<void> {
  if (!integrations.sentry || !getSentryDsn()) {
    return;
  }

  const Sentry = await import("@sentry/nextjs");
  if (context.userId) {
    Sentry.setUser({
      id: context.userId,
      email: context.userEmail ?? undefined,
    });
  }
  if (context.tenantId) {
    Sentry.setTag("tenant_id", context.tenantId);
  }
  if (context.workspaceId) {
    Sentry.setTag("workspace_id", context.workspaceId);
  }
  if (context.projectId) {
    Sentry.setTag("project_id", context.projectId);
  }
  Sentry.setContext("bob", cleanContext({ serviceName, ...context }));
}

export async function captureException(
  error: unknown,
  context?: ObservabilityContext,
): Promise<void> {
  if (!integrations.sentry || !getSentryDsn()) {
    return;
  }

  const Sentry = await import("@sentry/nextjs");
  Sentry.withScope((scope) => {
    scope.setContext("bob", cleanContext({ serviceName, ...context }));
    if (context?.userId) {
      scope.setUser({
        id: context.userId,
        email: context.userEmail ?? undefined,
      });
    }
    for (const [key, value] of Object.entries(cleanContext(context))) {
      scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}

export async function captureMessage(
  message: string,
  context?: ObservabilityContext,
): Promise<void> {
  if (!integrations.sentry || !getSentryDsn()) {
    return;
  }

  const Sentry = await import("@sentry/nextjs");
  Sentry.withScope((scope) => {
    scope.setContext("bob", cleanContext({ serviceName, ...context }));
    Sentry.captureMessage(message);
  });
}

export async function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const apiKey = posthogKey ?? getPostHogKey();
  if (!integrations.posthog || !apiKey) {
    return;
  }

  const distinctId =
    typeof properties?.userId === "string" ? properties.userId : serviceName;
  await fetch(`${posthogHost}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: {
        environment,
        serviceName,
        release,
        ...properties,
      },
    }),
  }).catch(() => {});
}

export async function identifyUserTenant(
  context: ObservabilityContext,
): Promise<void> {
  if (!integrations.posthog || !posthogKey || !context.userId) {
    return;
  }

  await trackEvent("$identify", {
    userId: context.userId,
    distinct_id: context.userId,
    $set: {
      email: context.userEmail ?? undefined,
      tenantId: context.tenantId ?? undefined,
      workspaceId: context.workspaceId ?? undefined,
    },
  });

  if (context.tenantId) {
    await trackEvent("$groupidentify", {
      userId: context.userId,
      $group_type: "tenant",
      $group_key: context.tenantId,
      $group_set: {
        tenantId: context.tenantId,
      },
    });
  }
}
