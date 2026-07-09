import type { ObservabilitySurface } from "./config.js";
import {
  buildDistinctId,
  buildIdentityProperties,
  type IdentityContext,
} from "./identity.js";
import { getAlertById } from "./alerts.js";

export interface FailureContext extends IdentityContext {
  surface: ObservabilitySurface;
  operation: string;
  error: unknown;
  alertId?: string;
  metadata?: Record<string, unknown>;
}

export function normalizeError(error: unknown): {
  name?: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: "Unknown error" };
}

export function buildFailurePayload(
  context: FailureContext,
): Record<string, unknown> {
  const normalized = normalizeError(context.error);
  const alert = context.alertId ? getAlertById(context.alertId) : undefined;
  const identity = buildIdentityProperties(context);

  return {
    surface: context.surface,
    operation: context.operation,
    alert_id: alert?.id,
    alert_severity: alert?.severity,
    error_name: normalized.name,
    error_message: normalized.message,
    ...identity,
    ...context.metadata,
  };
}

export function getFailureEventName(context: FailureContext): string {
  if (context.alertId) {
    const alert = getAlertById(context.alertId);
    if (alert) return alert.posthogEvent;
  }

  switch (context.surface) {
    case "api":
      return "critical_api_failure";
    case "job":
      return "critical_job_failure";
    case "gateway":
      return "critical_gateway_failure";
  }
}

export function getFailureSentryTags(context: FailureContext): Record<string, string> {
  const alert = context.alertId ? getAlertById(context.alertId) : undefined;
  const tags: Record<string, string> = {
    surface: context.surface,
    operation: context.operation,
  };
  if (alert) {
    const [key, value] = alert.sentryTag.split(":");
    if (key && value) tags[key] = value;
  }
  return {
    ...tags,
    ...buildIdentityProperties(context),
  };
}

export function getFailureDistinctId(context: FailureContext): string {
  return (
    buildDistinctId(context) ??
    context.tenant?.workspaceId ??
    `bob-${context.surface}`
  );
}
