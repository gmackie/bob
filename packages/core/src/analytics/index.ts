// @gmacko/analytics — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Analytics` — Effect service: `track`, `identify`, `group`.
//   - `layerAnalyticsStub` — Layer that fails every method with the tagged error.
//   - Tagged error: `AnalyticsNotImplementedError`.
//   - Types: `AnalyticsEvent`, `AnalyticsShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). Driver-agnostic
// (Segment / PostHog / Plausible / Mixpanel adapters land per Bob's needs).
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface AnalyticsEvent {
  readonly name: string;
  readonly properties?: Record<string, unknown>;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly timestamp?: Date;
}

export class AnalyticsNotImplementedError extends Schema.TaggedErrorClass<AnalyticsNotImplementedError>()(
  "AnalyticsNotImplementedError",
  {
    reason: Schema.String,
    event: Schema.optional(Schema.String),
  },
) {}

export interface AnalyticsShape {
  readonly track: (
    event: AnalyticsEvent,
  ) => Effect.Effect<void, AnalyticsNotImplementedError>;
  readonly identify: (
    userId: string,
    traits?: Record<string, unknown>,
  ) => Effect.Effect<void, AnalyticsNotImplementedError>;
  readonly group: (
    groupId: string,
    traits?: Record<string, unknown>,
  ) => Effect.Effect<void, AnalyticsNotImplementedError>;
}

export const Analytics = ServiceMap.Service<AnalyticsShape>(
  "@gmacko/analytics/Analytics",
);

const reason = "@gmacko/analytics: deferred to Phase 7 (Bob migration)";

export const layerAnalyticsStub: Layer.Layer<AnalyticsShape> = Layer.succeed(
  Analytics,
  {
    track: (event) =>
      Effect.fail(
        new AnalyticsNotImplementedError({ reason, event: event.name }),
      ),
    identify: () =>
      Effect.fail(new AnalyticsNotImplementedError({ reason })),
    group: () => Effect.fail(new AnalyticsNotImplementedError({ reason })),
  },
);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoAnalyticsPhase = "6l" as const;
