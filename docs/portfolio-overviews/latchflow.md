# Portfolio overview: Latchflow

Use `--startup <uuid>` for `pulse agent context` / `growth review` (slug `latchflow` fails validation). Startup ID: `92f7b341-a018-4616-a52c-8f8247a5f4e6` (`pulse status --json`).

## Lifecycle stage

**Launched** lifecycle; **incubating** portfolio role. Escape-room puzzle builder (`latchflow.io`; ForgeGraph notes; repo `escape-puzzles-ui`).

## Health grade

**A**, **thriving**, ops **80**. **Operational 100**, **infrastructure 55**. Financial, product, reliability, compliance, and growth dimensions are largely **unavailable**/zero-weighted today.

## Key metrics

Ops **80 / A**. KPI rollup: **MRR 0**, **0** customers/subscriptions, **DAU 0**, no failed-payment or error spikes. Linear, Twenty, ForgeGraph, and Stripe connected; **warning** urgency from **ForgeGraph ~523 h** stale sync and **Stripe ~238 h** stale sync. Daily cadence: **stabilize**—clear warnings before growth work.

## Top bottleneck

**Stale ForgeGraph + Stripe syncs** degrade deployment/billing truth while **`growth review` shows no urgent funnel bottleneck**—data freshness is the gating ops issue.

## Recommended next action

**Resync/repair ForgeGraph and Stripe** (or `pulse sync forgegraph latchflow`, `pulse sync stripe latchflow`), then wire **PostHog, Sentry,** finance, and CRM/compliance connectors so broader dimensions can score.
