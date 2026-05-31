# Observability Alerts

Runtime instrumentation is enabled by `@bob/config` and activates when these
environment variables are present:

- `SENTRY_DSN`
- `POSTHOG_KEY` or `POSTHOG_PROJECT_API_KEY`
- `POSTHOG_HOST` when not using `https://us.i.posthog.com`

Configure these P1 alerts before production launch:

- Sentry issue alert: `serviceName:blder-api operation:trpc` with any new issue
  or regression in production.
- Sentry issue alert: `serviceName:blder-api operation:rest-api` with any new
  issue or regression in production.
- Sentry issue alert: `serviceName:ws-gateway operation:relay` with more than 5
  events in 10 minutes.
- Sentry issue alert: `serviceName:ws-gateway operation:persist_session_events`
  with any event in production.
- Sentry issue alert: `serviceName:bob-server operation:proxy` with more than 3
  events in 10 minutes.
- PostHog insight alert: `gateway_persistence_failed` count greater than 0 over
  5 minutes.
- PostHog insight alert: `gateway_session_send_missed` count greater than 10
  over 15 minutes.

All server captures include `userId`, `tenantId`, `workspaceId`, and `projectId`
when request context provides them. PostHog receives `$identify` events for API
users and `$groupidentify` for tenants.
