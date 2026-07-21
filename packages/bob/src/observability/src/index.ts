export {
  resolveObservabilityConfig,
  getSentryInitOptions,
  isObservabilityEnabled,
  type ObservabilityConfig,
  type ObservabilitySurface,
  type SentryConfig,
  type PostHogConfig,
  type EnvMap,
  type ResolveObservabilityConfigOptions,
} from "./config.js";

export {
  buildIdentityTags,
  buildIdentityProperties,
  buildDistinctId,
  type UserIdentity,
  type TenantIdentity,
  type IdentityContext,
} from "./identity.js";

export {
  buildFailurePayload,
  getFailureEventName,
  getFailureSentryTags,
  getFailureDistinctId,
  normalizeError,
  type FailureContext,
} from "./failures.js";

export {
  OBSERVABILITY_ALERTS,
  getAlertsForSurface,
  getAlertById,
  type ObservabilityAlertDefinition,
  type AlertSeverity,
} from "./alerts.js";

export {
  initNodeObservability,
  shutdownNodeObservability,
  identifyUser,
  identifyTenant,
  captureCriticalFailure,
  trackEvent,
  getActiveObservabilityConfig,
  __resetNodeObservabilityForTests,
} from "./node.js";
