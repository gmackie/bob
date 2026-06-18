# Portfolio overview: dailydose

**Generated from BizPulse (`pulse`), slug `dailydose`.** `pulse agent context --json` and `pulse growth review --json` require `--startup <uuid>` (`9d101191-e886-44ec-920f-624a9e9b5371` from `pulse status --json`); the slug alone is rejected.

**Lifecycle stage:** Product lifecycle **prototype**; portfolio role **incubating**. **DailyDose: Affirmations** (iOS), bundle `com.gmacko.dailydose`, repo **dailydose**. Naming resolved; **Gmacko LLC**–owned.

**Health grade:** **B**, status **healthy**, composite **ops score 77**. Only **operational** contributes (**77**); financial, product, reliability, infrastructure, compliance, and growth dimensions **do not score** yet. Ops headline cites **stale connector sync**.

**Key metrics:** No KPI row (**null**) — no Pulse-reported MRR, subscriptions, or DAU. **App Store Connect** is **connected**. **PostHog** is **disconnected** (`posthog_project_limit`). **Sentry** is **`auth_failed`** (portfolio **urgent**).

**Top bottleneck:** `pulse growth review` reports **no urgent bottleneck**. In practice the limit is **missing observability and revenue telemetry**: analytics and errors are not reliably flowing, so experiments and scorecards lack fuel.

**Recommended next action:** **Fix Sentry authentication**, **unblock or provision PostHog** for this project, then wire **Stripe/QuickBooks, ForgeGraph, entity/compliance, CRM/Growth** so KPIs and growth evidence can surface in reviews.
