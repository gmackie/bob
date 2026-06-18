# Portfolio overview: levelforge

Pulse commands `agent context` / `growth review` expect `--startup <uuid>` (slug `levelforge` is rejected). Data below uses ID `fa85e5c4-250d-4d3b-804a-f8ac0de0b913` from `pulse status --json`.

## Lifecycle stage

**Launched** product lifecycle; portfolio role **incubating**. Positioning: game asset catalog and AI gap-fill (`levelforge.io`).

## Health grade

**B**, **healthy**, ops score **63**. Strong **operational (100)** and partial **infrastructure (55)** signal; **growth (22)** lags. Financial, product, reliability, and compliance dimensions are not yet contributing.

## Key metrics

- Ops: **63 / B**, growth dimension **22**, infrastructure **55**.  
- CRM (Twenty): **5** stale contacts (14d threshold), **6** deals, **0** recent activities.  
- Connectors: Linear, ForgeGraph, Twenty, Stripe, EAS connected; ForgeGraph sync lag noted in CLI (~21d).

## Top bottleneck

**CRM follow-up coverage**: stalled outbound/logging — headline “CRM is constrained by CRM follow-up coverage.”

## Recommended next action

Run or approve Twenty **create_followups** for stale qualified relationships (high priority, 14d staleness). Refresh ForgeGraph sync and wire PostHog/Sentry (and related connectors) so growth and reliability scores reflect reality.
