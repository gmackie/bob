# Portfolio overview: StreamConductor

**Source:** BizPulse CLI — `pulse agent context` and `pulse growth review` with startup ID `8eaa2cdb-44ff-45cf-98b2-58353f628531` (slug `streamconductor`; those commands require a UUID, not the slug).

**Lifecycle stage:** **Prototype** (`lifecycleStage`); portfolio role **incubating**, Gmacko-owned. App originated from App Store metadata (former name **SteamConductor**).

**Health grade:** **A — thriving**, composite **ops score 83**. Only the **operational** dimension contributes; financial, product, reliability, infrastructure, compliance, and growth are **unscored** until more data lands.

**Key metrics:** No **objectives** in Pulse yet. **App Store Connect** connected; **PostHog** connected (sync stale ~9 days per `pulse startup show`); **Sentry** **`auth_failed`**. Portfolio **status** puts StreamConductor on **daily/stabilize** (production / revenue / integration attention).

**Top bottleneck:** Formal growth review: **no urgent bottleneck**. Practically: **failed Sentry** plus **thin instrumentation and dimension coverage**, aligned with the stabilize queue.

**Recommended next action:** **Fix Sentry auth**, bring **PostHog** current, then connect **Stripe/QuickBooks, ForgeGraph, entity/compliance, and CRM/Growth** so grades reflect real signals; add a **measurable growth objective** next.
