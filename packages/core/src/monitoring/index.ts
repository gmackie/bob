// @gmacko/monitoring — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Logger` — info/warn/error (no-op in stub; never fails).
//   - `Metrics` — counter/gauge/histogram (fails with `MonitoringNotImplementedError`).
//   - `Tracing` — span (pass-through; tracing is opt-in).
//   - `layerLoggerStub` / `layerMetricsStub` / `layerTracingStub` / `layerMonitoringStub`.
//   - Tagged error: `MonitoringNotImplementedError`.
//   - Types: `MetricLabels`, `LoggerShape`, `MetricsShape`, `TracingShape`.
//
// Logger is no-op so call sites can wire `info(...)` everywhere without runtime
// noise. Metrics fail because silently dropping observability data hides bugs;
// callers will know they need a real backend. Tracing is pass-through to avoid
// breaking instrumented control flow when no exporter is wired.
//
// Real implementation deferred to Phase 7 (Bob migration).
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface MetricLabels {
  readonly [key: string]: string | number;
}

export class MonitoringNotImplementedError extends Schema.TaggedErrorClass<MonitoringNotImplementedError>()(
  "MonitoringNotImplementedError",
  {
    reason: Schema.String,
  },
) {}

export interface LoggerShape {
  readonly info: (
    message: string,
    attrs?: Record<string, unknown>,
  ) => Effect.Effect<void>;
  readonly warn: (
    message: string,
    attrs?: Record<string, unknown>,
  ) => Effect.Effect<void>;
  readonly error: (
    message: string,
    attrs?: Record<string, unknown>,
  ) => Effect.Effect<void>;
}

export interface MetricsShape {
  readonly counter: (
    name: string,
    labels?: MetricLabels,
  ) => Effect.Effect<void, MonitoringNotImplementedError>;
  readonly gauge: (
    name: string,
    value: number,
    labels?: MetricLabels,
  ) => Effect.Effect<void, MonitoringNotImplementedError>;
  readonly histogram: (
    name: string,
    value: number,
    labels?: MetricLabels,
  ) => Effect.Effect<void, MonitoringNotImplementedError>;
}

export interface TracingShape {
  readonly span: <A, E, R>(
    name: string,
    attributes: Record<string, unknown>,
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | MonitoringNotImplementedError, R>;
}

export const Logger = ServiceMap.Service<LoggerShape>(
  "@gmacko/monitoring/Logger",
);
export const Metrics = ServiceMap.Service<MetricsShape>(
  "@gmacko/monitoring/Metrics",
);
export const Tracing = ServiceMap.Service<TracingShape>(
  "@gmacko/monitoring/Tracing",
);

const reason = "@gmacko/monitoring: deferred to Phase 7 (Bob migration)";
const failMon = (): Effect.Effect<never, MonitoringNotImplementedError> =>
  Effect.fail(new MonitoringNotImplementedError({ reason }));

export const layerLoggerStub: Layer.Layer<LoggerShape> = Layer.succeed(Logger, {
  info: () => Effect.void,
  warn: () => Effect.void,
  error: () => Effect.void,
});

export const layerMetricsStub: Layer.Layer<MetricsShape> = Layer.succeed(
  Metrics,
  {
    counter: () => failMon(),
    gauge: () => failMon(),
    histogram: () => failMon(),
  },
);

export const layerTracingStub: Layer.Layer<TracingShape> = Layer.succeed(
  Tracing,
  {
    // Pass-through: tracing is opt-in. The shape's wider error type is
    // widened by the return type (E | MonitoringNotImplementedError), never
    // produced here.
    span: (_name, _attrs, work) => work,
  },
);

export const layerMonitoringStub: Layer.Layer<
  LoggerShape | MetricsShape | TracingShape
> = Layer.mergeAll(layerLoggerStub, layerMetricsStub, layerTracingStub);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoMonitoringPhase = "6l" as const;
