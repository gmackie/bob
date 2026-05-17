# Portfolio overview: ForgeGraph

Pulse `agent context` / `growth review` require `--startup <uuid>`; slug `forgegraph` is invalid. ID: `729928c4-8aaf-42f0-bf9a-7a8bb857e4cd` (from `pulse startup list --json` / `pulse status --json`).

## Lifecycle stage

**Prototype**; portfolio **incubating**. Gmacko-owned; **forgegraf.com** (bundle `com.gmacko.forgegraf`).

## Health grade

**B**, **healthy**, ops **77**. Only **operational (77)** scores; finance, product, reliability, infrastructure, compliance, and growth are **unavailable** until connectors feed data. Status headline: *healthy — stale connector sync.*

## Key metrics

Ops **77 / B**. **App Store Connect**: connected. **PostHog**: disconnected (`posthog_project_limit`). **Sentry**: **auth_failed** (**urgent**). **Growth review**: no bottlenecks or persisted actions.

## Top bottleneck

**Integration / observability**: Sentry down blocks errors; PostHog blocked by limits; most score dimensions empty—portfolio guidance flags **stale connector sync** and missing Stripe/QuickBooks, ForgeGraph, CRM/Growth, and entity/compliance hooks.

## Recommended next action

**Fix Sentry credentials** and re-test ingest; **unblock PostHog** (raise limit or provision the ForgeGraph project). Then **wire the remaining integrations** from portfolio top actions so grades reflect real finance, delivery, and growth.
