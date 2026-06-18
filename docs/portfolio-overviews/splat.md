# Portfolio overview: splat

**Source:** BizPulse (`pulse agent context --json`, `pulse growth review --json`) with `--startup fbb715c0-690f-4687-9410-9dfd7858193b`. Passing `--startup splat` fails validation (UUID required); resolve IDs with `pulse status --json`.

**Lifecycle stage:** **Launched**, portfolio role **incubating**. **splat.gmac.io**, repo **splat**, **Gmacko LLC** portfolio ownership.

**Health grade:** **A** (**thriving**), composite **ops score 80**. **Operational** dimension **100**; **infrastructure** **55** with signal. Financial, product, reliability, compliance, and **growth** dimensions are **not yet feeding** the ops scorecard.

**Key metrics:** Pulse attaches **Stripe** (product **Splat**), **Linear**, **Twenty** (CRM), and **ForgeGraph**; ForgeGraph sync is **weeks stale** (~21 days on CLI detail). Portfolio headline still reads strong but scorecard KPI depth is incomplete.

**Top bottleneck:** Automated **growth review** reports **no urgent bottleneck**. Operational risk clusters on **infra health / deployment posture** plus **telemetry and finance gaps**—low-dimensional scoring despite “thriving” status.

**Recommended next action:** Run an **infra + ForgeGraph freshness** pass first, then connect **PostHog, Sentry, accounting/finance, entity/compliance, and CRM/Growth** so metrics and bottlenecks are measurable—and add a **named growth objective** (current list empty).
