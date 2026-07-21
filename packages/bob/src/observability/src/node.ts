import * as Sentry from "@sentry/node";
import { PostHog } from "posthog-node";

import type { ObservabilityConfig } from "./config.js";
import {
  buildFailurePayload,
  getFailureDistinctId,
  getFailureEventName,
  getFailureSentryTags,
} from "./failures.js";
import type { FailureContext } from "./failures.js";
import { buildIdentityProperties } from "./identity.js";
import type {
  IdentityContext,
  TenantIdentity,
  UserIdentity,
} from "./identity.js";

let activeConfig: ObservabilityConfig | null = null;
let posthogClient: PostHog | null = null;
let sentryInitialized = false;

export function getActiveObservabilityConfig(): ObservabilityConfig | null {
  return activeConfig;
}

export function initNodeObservability(config: ObservabilityConfig): void {
  if (activeConfig) return;
  activeConfig = config;

  if (config.sentry.enabled && config.sentry.dsn) {
    Sentry.init({
      dsn: config.sentry.dsn,
      environment: config.environment,
      tracesSampleRate: config.sentry.tracesSampleRate,
      initialScope: {
        tags: {
          service: config.serviceName,
          ...(config.tenantId ? { tenant_id: config.tenantId } : {}),
        },
      },
    });
    sentryInitialized = true;
    console.log(
      `[observability] Sentry initialized (service=${config.serviceName}, env=${config.environment})`,
    );
  }

  if (config.posthog.enabled && config.posthog.apiKey) {
    posthogClient = new PostHog(config.posthog.apiKey, {
      host: config.posthog.host,
    });
    console.log(
      `[observability] PostHog initialized (service=${config.serviceName}, host=${config.posthog.host})`,
    );
  }

  if (!config.sentry.enabled && !config.posthog.enabled) {
    console.log(
      `[observability] disabled for ${config.serviceName} (no SENTRY_DSN or POSTHOG_KEY)`,
    );
  }
}

export async function shutdownNodeObservability(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
  if (sentryInitialized) {
    await Sentry.close(2000);
    sentryInitialized = false;
  }
  activeConfig = null;
}

export function identifyUser(user: UserIdentity, tenant?: TenantIdentity): void {
  const context: IdentityContext = { user, tenant };

  if (sentryInitialized) {
    Sentry.setUser({
      id: user.userId,
      email: user.email,
      username: user.name,
    });
    Sentry.setTags(buildIdentityProperties(context));
  }

  if (posthogClient) {
    posthogClient.identify({
      distinctId: user.userId,
      properties: {
        email: user.email,
        name: user.name,
        ...buildIdentityProperties({ tenant }),
      },
    });
    if (tenant?.tenantId) {
      posthogClient.groupIdentify({
        groupType: "tenant",
        groupKey: tenant.tenantId,
        properties: {
          tenant_slug: tenant.tenantSlug,
          workspace_id: tenant.workspaceId,
        },
      });
    }
  }
}

export function identifyTenant(tenant: TenantIdentity): void {
  if (sentryInitialized) {
    Sentry.setTags(buildIdentityProperties({ tenant }));
  }

  if (posthogClient && tenant.tenantId) {
    posthogClient.groupIdentify({
      groupType: "tenant",
      groupKey: tenant.tenantId,
      properties: {
        tenant_slug: tenant.tenantSlug,
        workspace_id: tenant.workspaceId,
      },
    });
  }
}

export function captureCriticalFailure(context: FailureContext): void {
  const payload = buildFailurePayload(context);
  const tags = getFailureSentryTags(context);
  const distinctId = getFailureDistinctId(context);
  const eventName = getFailureEventName(context);
  const normalized =
    context.error instanceof Error
      ? context.error
      : new Error(
          typeof context.error === "string"
            ? context.error
            : "Critical failure",
        );

  console.error(
    `[observability] critical ${context.surface} failure: ${context.operation}`,
    payload,
  );

  if (sentryInitialized) {
    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTags(tags);
      scope.setContext("failure", payload);
      Sentry.captureException(normalized);
    });
  }

  if (posthogClient) {
    posthogClient.capture({
      distinctId,
      event: eventName,
      properties: payload,
      groups: context.tenant?.tenantId
        ? { tenant: context.tenant.tenantId }
        : undefined,
    });
  }
}

export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
  context?: IdentityContext,
): void {
  if (!posthogClient) return;

  posthogClient.capture({
    distinctId: getFailureDistinctId({ surface: "api", operation: event, error: "", ...context }),
    event,
    properties: {
      ...properties,
      ...(context ? buildIdentityProperties(context) : {}),
    },
    groups: context?.tenant?.tenantId
      ? { tenant: context.tenant.tenantId }
      : undefined,
  });
}

/** Test-only reset. */
export function __resetNodeObservabilityForTests(): void {
  activeConfig = null;
  posthogClient = null;
  sentryInitialized = false;
}
