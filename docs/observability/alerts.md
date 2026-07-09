# Bob observability alerts

Alert definitions for Bob's Sentry and PostHog instrumentation. Each alert maps to a `alertId` emitted by `@bob/observability` when critical failures are captured.

Configure matching rules in:

- **Sentry** — issue alerts filtered by tag `surface` (`api`, `job`, `gateway`) and environment (`FG_STAGE` / `APP_ENV`).
- **PostHog** — insight alerts on events `critical_api_failure`, `critical_job_failure`, and `critical_gateway_failure`.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | worker, ws-gateway, execution | Error ingest |
| `NEXT_PUBLIC_SENTRY_DSN` | bob web (browser, optional) | Client error ingest |
| `POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` | server / web | Analytics ingest |
| `POSTHOG_HOST` / `NEXT_PUBLIC_POSTHOG_HOST` | all | PostHog region (default `https://us.i.posthog.com`) |
| `BOB_TENANT_ID` | all | Tenant tag on errors and analytics |
| `SENTRY_TRACES_SAMPLE_RATE` | all | Trace sampling (default `0.1`) |

## Alert catalog

### `api-trpc-5xx` — API tRPC 5xx failures

- **Service:** `bob-api`
- **Severity:** critical
- **Trigger:** tRPC procedure returns HTTP 5xx
- **Sentry tag:** `surface:api`
- **PostHog event:** `critical_api_failure`
- **Runbook:** Inspect recent deploys and database/Hyperdrive connectivity. Check Sentry stack traces for the failing procedure path.

### `gateway-persistence-failure` — Gateway session persistence failures

- **Service:** `bob-ws-gateway`
- **Severity:** critical
- **Trigger:** `PersistenceWriter` fails to flush session events to Postgres
- **Sentry tag:** `surface:gateway`
- **PostHog event:** `critical_gateway_failure`
- **Runbook:** Verify `DATABASE_URL`, Postgres health, and gateway memory. Session history may need manual reconciliation.

### `gateway-auth-failure-spike` — Gateway auth validation failures

- **Service:** `bob-ws-gateway`
- **Severity:** high
- **Trigger:** Repeated daemon/browser auth rejections (configure as Sentry spike alert on `surface:gateway` + `operation:auth`)
- **Runbook:** Rotate `NUDGE_SHARED_SECRET` / `BOB_API_KEY` if compromised; confirm `AUTH_BASE_URL` is reachable.

### `job-session-failure` — Execution session failures

- **Service:** `bob-execution`
- **Severity:** critical
- **Trigger:** Agent daemon fails to complete a dispatched session
- **Sentry tag:** `surface:job`
- **PostHog event:** `critical_job_failure`
- **Runbook:** Check executor logs for `sessionId`, working directory, and agent CLI availability.

### `job-gateway-disconnect` — Execution gateway disconnect

- **Service:** `bob-execution`
- **Severity:** high
- **Trigger:** WebSocket error between executor and ws-gateway
- **Runbook:** Confirm ws-gateway `/health` and `GATEWAY_WS_URL` network path.

### `auto-drain-failure` — Autonomous backlog drain failures

- **Service:** `bob-worker`
- **Severity:** high
- **Trigger:** Cloudflare cron `autoDrainBacklog` throws
- **Runbook:** Review worker cron logs, `BOB_AUTO_DRAIN_ENABLED`, and DB bindings.

## User and tenant identification

Authenticated dashboard sessions call `identifyBrowserUser` with:

- `user.id`, `user.email`, `user.name`
- `BOB_TENANT_ID` as PostHog group `tenant` and Sentry tag `tenant_id`

Node services (`bob-ws-gateway`, `bob-execution`) call `identifyTenant` at startup using `BOB_TENANT_ID` and `BOB_WORKSPACE_ID`.

## Suggested Sentry alert rules

1. **Critical API errors** — `surface:api`, level error, >5 events in 5 minutes → PagerDuty/Slack
2. **Gateway persistence** — `alert_id:gateway-persistence-failure`, any event → immediate page
3. **Job failures** — `surface:job`, level error, >3 events in 15 minutes → Slack

## Suggested PostHog insights

1. **Critical failure trend** — weekly count of `critical_*_failure` by `surface`
2. **Tablet adoption** — `tablet_session_start` events with `duration_seconds` from mobile-bob
3. **Tenant activity** — unique users per `tenant` group per week
