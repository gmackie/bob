# Portfolio overview: Crucible

**Source:** BizPulse CLI — `pulse agent context` and `pulse growth review` require startup UUID `f604f071-ee40-4d48-9c4a-3bc0383dcf13` (slug `crucible` is rejected by those commands).

**Lifecycle stage:** **Prototype**; portfolio role **incubating**, Gmacko-owned. Created from App Store Connect metadata (former listing **crucibl**; bundle `com.gmacko.crucible`, app id `6767311844`).

**Health grade:** **B — healthy**, composite **ops score 77**. Only **operational** contributes (**77**); financial, product, reliability, infrastructure, compliance, and growth remain **unscored**. Pulse headline: healthy with **stale connector sync**.

**Key metrics:** No **objectives** yet. **App Store Connect** connected. **PostHog** **disconnected** (agent context: provisioning blocked by **`posthog_project_limit`**). **Sentry** **`auth_failed`**; portfolio **urgency** flags expired credentials. **Operating queue:** **daily / stabilize** — stabilize integrations.

**Top bottleneck:** Formal **growth review** finds **no urgent bottleneck**. Operationally, the constraint is **integration health**: dead **Sentry** and missing **PostHog** leave errors and product analytics largely invisible.

**Recommended next action:** **Restore Sentry authentication** (rotate token / fix org-project mapping), then **unblock PostHog** (capacity or dedicated project). Re-run syncs and connect **Stripe/QuickBooks, ForgeGraph, entity/compliance, and CRM/Growth** so grades reflect real signals; add one **measurable growth objective** next.
