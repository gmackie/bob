# Production telemetry verification

Host services publish OTLP/HTTP to their existing local collector. Workers publish
OTLP/HTTP JSON to the existing public collector. Stable service identities are
`bob`, `ooda`, `bob-host`, `bob-ws-gateway`, `ooda-runner` and
`ooda-research-backend`. The standalone daemon uses `bob-execution` when active.

Set the following in a versioned systemd EnvironmentFile loaded after existing
application environment files; preserve all existing credentials and feature flags:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
```

Set `OTEL_SERVICE_NAME` separately for each service. `OTEL_SDK_DISABLED=true`
disables instrumentation. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` selects an exact
signal URL and takes precedence over the base endpoint. Exporter authentication
belongs in secret environment configuration, never checked-in plaintext.

The separate existing Bob host API is not the public Worker or desktop runtime.
To instrument its existing versioned runtime without replacing the app build,
bundle `packages/core/src/telemetry/node.ts` as `telemetry-node.cjs` using esbuild
with `--bundle --platform=node --format=cjs`, and stage it alongside
`start-host.mjs`. Launch with explicit runtime directory, port and bind address:

```
node start-host.mjs /path/to/existing/runtime 3200 127.0.0.1
```

Retain its current working directory, application environment, and old service
override as rollback. Smoke-test on a separate port before replacing ExecStart.
The launcher wraps the actual returned HTTP server, so it does not depend on
framework discovery of Next.js instrumentation hooks.

For each release, send a harmless HTTP request with a fresh valid W3C
`traceparent`. Confirm normal response status, then query the telemetry store for
that exact trace ID and parent span ID. Verify the expected service identity and
recent timestamp. A response trace header, HTTP 200 from the collector, or SDK
initialization log alone does not prove storage. Check collector accepted/sent/
failed span counters and derived span metrics separately.

Telemetry does not record request bodies, authentication headers or query values.
Node request paths use an explicit safe route allowlist; unknown paths retain only
the HTTP method. Export failures must not change application responses. Runtime
signal owners await SDK shutdown before process exit.
