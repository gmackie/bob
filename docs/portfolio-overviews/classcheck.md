# Portfolio overview: ClassCheck

Pulse `agent context` / `growth review` need `--startup <uuid>` (`classcheck` slug fails). Use ID **`3d453cad-65ce-417f-b387-28be705cfd62`** from **`pulse status --json`**.

## Lifecycle stage

**Prototype**, **incubating** (**gmacko_owned**). App Store Connect for **classcheck-app** (`com.classback.classcheck`). Naming resolved (formerly ClassBack).

## Health grade

**A**, score **83**, status **thriving** — effectively **operational** signal only; financial, product, reliability, infra, compliance, growth are **unset**. **Urgent** alerts: **Sentry auth_failed**, **PostHog** sync stale (~May 7 last success). Grade reflects partial telemetry, not full stack health.

## Key metrics

- Ops **83 / A** on one pillar.  
- Pulse **objectives**, **recentActions**, **campaigns**, **playbookRuns**: empty.  
- **Growth review** JSON: no bottlenecks, no proposed actions — thin evidence inputs.

## Top bottleneck

**Live analytics / error telemetry** — stale PostHog and failing Sentry block reliable product and funnel insight; automated growth tooling has little to chew on.

## Recommended next action

Restore **Sentry** auth and refresh **PostHog** ingestion, then add remaining connectors Pulse suggests (ForgeGraph, finance, CRM) so growth reviews surface real bottlenecks.
