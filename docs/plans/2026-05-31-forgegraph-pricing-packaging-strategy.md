# ForgeGraph Pricing and Packaging Strategy

Date: 2026-05-31
Status: Founder review draft
Issue: GMA-50

## Goal

Define a prototype-stage pricing and packaging hypothesis for ForgeGraph that learns willingness to pay without locking the open-source surface behind early commercial choices.

This is a decision log, not approval to implement billing.

## Current Context

ForgeGraph is becoming the canonical graph for work items, changesets, CI evidence, deployment state, promotion policy, and release audit history. Bob and blder.bot act as planning and execution layers against that graph.

That means ForgeGraph value is not just issue tracking. The buyer-facing value is delivery control: knowing what changed, whether it passed policy, where it deployed, and whether it is safe to promote.

## Pricing Principles

1. Keep the self-hosted developer path usable.
2. Charge where ForgeGraph absorbs real operating cost or risk.
3. Avoid pricing that punishes small teams for adding collaborators.
4. Learn from concrete upgrade asks before adding Stripe.
5. Keep enterprise-only features tied to procurement, compliance, support, or infrastructure isolation.

## Value Metric Candidates

### Seats

Pros:

- Familiar to buyers because GitHub and Linear use seat-based anchors.
- Easy to understand and implement in Stripe.
- Maps to support burden when every active user can file issues and ask for help.

Cons:

- Bad fit for OSS and small teams that want broad visibility.
- Can discourage inviting reviewers, operators, founders, or clients.
- Weakly correlated with ForgeGraph's hosted cost drivers.

Prototype take:

- Use seats only as a soft commercial qualifier, not the primary metered value.
- Include a generous seat cap in paid self-serve to keep indie and small-team adoption viable.

### Environments

Pros:

- Maps directly to ForgeGraph's differentiated surface: dev, staging, production, previews, and promotion gates.
- Easy for teams to understand because more environments mean more release coordination.
- Better than seats for pricing deployment confidence.

Cons:

- Definitions can get fuzzy across apps, repos, branches, and ephemeral previews.
- Teams may avoid modeling real environments if pricing is too sensitive.

Prototype take:

- Strong candidate for packaging gates.
- Free should support one local/dev environment. Paid should add staging and production gates.

### Clusters or Hosted Runners

Pros:

- Tied to infrastructure cost, isolation, and enterprise deployment complexity.
- Useful for later hosted margin if ForgeGraph runs policy workers, build proxies, or deploy agents.

Cons:

- Too infrastructure-centric for early buyers.
- Can make ForgeGraph sound like another CI provider instead of a delivery graph.

Prototype take:

- Keep as an enterprise/contact-us metric only.
- Do not expose it in the first self-serve pricing page.

### Work Items, Revisions, or Deployments

Pros:

- Close to product usage.
- Helps protect hosted storage, event ingestion, and audit-log costs.
- Makes heavy automation accounts pay more than hobby users.

Cons:

- Can feel like a tax on successful usage.
- Hard to explain before users understand the product.
- May create incentives to delete history or avoid recording small changes.

Prototype take:

- Use generous fair-use limits for hosted plans, then contact-us for sustained high volume.
- Do not meter the OSS/self-hosted product by work items or revisions.

### Compute Proxy or Promotion Minutes

Pros:

- Directly maps to real hosted cost if ForgeGraph later runs policy checks, build proxies, staging smoke tests, or deploy orchestration.
- Lets self-hosted users stay free while hosted users pay for managed execution.

Cons:

- Premature until ForgeGraph actually owns compute-heavy workflows.
- Usage-based bills can scare indie teams.

Prototype take:

- Future paid add-on, not v0 packaging.
- If introduced, include hard spend limits and clear included credits.

## Recommended Prototype Value Metric

Use package-based pricing with:

- Primary self-serve metric: active projects/apps with production promotion enabled.
- Secondary guardrail: fair-use limits for events, revisions, deployments, and artifact retention.
- Enterprise metric: isolated tenants, clusters, compliance controls, custom retention, and support SLA.

Rationale: production promotion is where ForgeGraph provides high-stakes value and where hosted operation creates real support risk. It is also less hostile than charging for every collaborator.

## Packaging Hypothesis

### Tier 1: Community / OSS

Target user:

- Solo developers, OSS maintainers, local prototypes, teams evaluating ForgeGraph.

Included:

- Self-hosted ForgeGraph core.
- Work item graph.
- Local/dev environment tracking.
- Basic changeset and CI evidence ingestion.
- Basic deployment records.
- Public docs and community support.
- Bob/blder.bot integration primitives needed to dogfood the graph.

Excluded:

- Managed hosting.
- Production promotion automation.
- Long hosted retention.
- SSO, SCIM, audit export, SLA, priority support.
- Managed compute proxy or hosted policy workers.

Cost driver protected:

- Community tier should not create meaningful hosted infrastructure or support obligations.

Decision:

- Keep this tier useful enough that the OSS surface is credible.

### Tier 2: Team / Hosted

Target user:

- Indie products and small engineering teams that want managed ForgeGraph without enterprise procurement.

Included:

- Managed hosted ForgeGraph workspace.
- Up to 3 active production-enabled projects/apps.
- Up to 10 active seats, with free viewers where possible.
- Dev, staging, and production environment model.
- Promotion gates and approval history.
- GitHub integration and deployment evidence.
- 30 to 90 days hosted event and artifact retention.
- Email or async support with best-effort response.
- Hard usage caps and spend limits before any usage billing.

Paid boundaries:

- Additional production-enabled projects/apps.
- Longer retention.
- Higher event/deployment volume.
- Optional hosted policy or compute proxy once it exists.

Cost drivers:

- Hosted database/storage.
- Event ingest volume.
- Artifact retention.
- Support burden from production promotion workflows.

Starter price band hypothesis:

- $19 to $49/month for the first workspace, including 1 to 3 production-enabled projects/apps.
- $10 to $20/month per additional production-enabled project/app.
- Avoid per-seat charges until there is evidence that seat count predicts support burden.

Assumptions:

- Early users are indie founders and small teams comparing this to GitHub Team, Linear Basic/Business, Vercel Pro, and Sentry Team/Business.
- ForgeGraph is not yet a mature compliance platform, so the entry price should be closer to developer tools than enterprise DevOps platforms.
- Users will tolerate project/app pricing if it maps to production release control.

### Tier 3: Enterprise / Contact Us

Target user:

- Companies needing security review, procurement, production isolation, custom deployment, or formal support.

Included:

- SSO/SAML, SCIM, domain verification.
- Advanced audit export and longer retention.
- Custom environment and policy models.
- Dedicated tenant, region controls, or customer-managed deployment.
- Custom clusters or runners.
- Security questionnaires, DPA/BAA review if applicable, SLA, priority support.
- Migration/onboarding support.

Pricing model:

- Annual contract.
- Quote by production-enabled apps, isolated infrastructure needs, retention, and support level.

Cost drivers:

- Security and legal review time.
- Dedicated infrastructure.
- Onboarding and migration labor.
- Support SLA and incident response obligations.
- Compliance artifacts and custom terms.

## Competitive Anchors Checked

Sources checked on 2026-05-31:

- GitHub pricing: https://github.com/pricing
- Linear pricing: https://linear.app/pricing
- Vercel pricing: https://vercel.com/pricing
- Sentry pricing: https://sentry.io/pricing

Observed anchors:

- GitHub has a free plan, Team around low single-digit dollars per user/month, and Enterprise around low tens per user/month.
- Linear uses free, Basic around $10/user/month, Business around $16/user/month, and custom Enterprise.
- Vercel uses free Hobby, Pro around $20/month plus usage, and Enterprise for security, SLA, advanced support, and custom needs.
- Sentry uses free Developer, Team around mid-tens/month, Business around low hundreds/month, then custom Enterprise, with usage-driven event economics.

Implication:

- ForgeGraph should not start above $49/month unless the buyer is clearly using managed production promotion.
- A $19 to $49/month Team plan is plausible for small teams if it includes hosted convenience and production confidence.
- Enterprise should stay contact-us until support motion, compliance posture, and deployment isolation are understood.

## Stripe and Commercial Path Timing

### Stay invite-only while:

- The hosted product still needs founder-assisted onboarding.
- Production promotion failure modes are not fully documented.
- Support questions require engineering intervention more than once per active team per month.
- Usage limits and retention policies are not implemented.
- There is no clear path to suspend, downgrade, export, or delete tenant data.
- License and commercial terms are unresolved.

### Turn on Stripe when:

- At least 5 to 10 teams have completed onboarding without founder-led setup.
- At least 3 teams have asked to keep using hosted ForgeGraph after an evaluation window.
- Support burden is below a sustainable threshold, for example less than one high-touch support event per active team per month.
- The Team tier has explicit limits for projects/apps, retention, and event volume.
- Billing state can be enforced without corrupting the graph or blocking OSS self-hosting.
- There is a documented upgrade path from Community to Team and from Team to Enterprise.

### Implementation dependencies before billing:

- Tenant/workspace plan field and entitlement checks.
- Retention policy for hosted event/artifact data.
- Usage counters for production-enabled projects/apps, revisions, deployments, and stored artifacts.
- Admin UI for plan, limits, invoices, and cancellation.
- Export/delete workflow.
- Support process and SLA language.

Decision:

- Do not implement Stripe for GMA-50.
- Use invite-only paid pilots or founder-issued invoices first if needed.

## License Risk Review

Current repository signal:

- Root `package.json` declares `GPL-3.0`.
- Root `LICENSE` is GPL-3.0 text.
- Package templates still default new packages to MIT, so the intended licensing boundary is not fully consistent.

### MIT / Apache-2.0

Pros:

- Lowest enterprise adoption friction.
- Easiest for SDKs, CLIs, protocol definitions, and integrations.
- Encourages ecosystem contributions and embedding.

Cons:

- Weak protection against hosted clones.
- Commercial moat must come from hosting, support, brand, integrations, and velocity.

### GPL-3.0

Pros:

- Stronger copyleft for distributed modifications.
- Existing repo already points here, so it requires fewer immediate changes than relicensing.

Cons:

- Enterprise legal teams may avoid embedding or shipping GPL components.
- Does not close the hosted-SaaS loophole in the way AGPL does.
- Can conflict with a permissive SDK/plugin ecosystem if boundaries are unclear.

### AGPL-3.0

Pros:

- Better protection against competitors running modified hosted versions without sharing changes.
- Common enough in infrastructure OSS to be understood.

Cons:

- Higher enterprise adoption friction than MIT/Apache.
- Can make integrations, embedding, and procurement slower.
- May push serious enterprise prospects toward private license requests earlier than desired.

### Source-Available / Dual License

Pros:

- Preserves commercial control and allows enterprise exceptions.
- Can make hosted business model clearer.

Cons:

- Not true OSS.
- Reduces community trust and contribution surface.
- Adds legal and messaging complexity too early.

## License Recommendation

Do not switch the whole project to AGPL during prototype.

Recommended near-term posture:

- Make SDKs, protocol schemas, API clients, and local developer tools permissive where possible.
- Keep the server/control-plane license decision under founder review before public launch.
- If clone protection matters more than enterprise embedding, use AGPL only for the hosted control plane/server, not for SDKs or integration surfaces.
- If enterprise adoption and ecosystem growth matter more, prefer Apache-2.0 or MIT for core surfaces and monetize managed hosting, retention, policy automation, support, and enterprise controls.

Open questions:

- Is ForgeGraph intended to be true OSS, open-core, or source-available?
- Which components must be safe for customers to embed in proprietary systems?
- Is hosted clone protection more important than reducing enterprise legal friction?
- Should Bob, blder.bot, ForgeGraph server, SDKs, and package templates share one license or use explicit component-level licenses?
- Who owns legal approval for relicensing existing code and dependencies?

## Founder Review Decisions Needed

1. Confirm whether production-enabled projects/apps should be the first paid metric.
2. Choose the Team starter price to test first: $19, $29, or $49/month.
3. Decide whether self-serve paid Team is blocked on Stripe or whether paid pilots can use manual invoices.
4. Decide license posture before public ForgeGraph positioning: permissive core, AGPL server, current GPL, or source-available.
5. Define the first Enterprise trigger: SSO, dedicated tenant, custom retention, SLA, or procurement/security review.

## Proposed Initial Decision

For prototype:

- Community: self-hosted, useful, no managed guarantees.
- Team: invite-only hosted, $29/month hypothesis, includes up to 3 production-enabled projects/apps and generous viewers.
- Enterprise: contact-us for SSO, dedicated tenant, custom retention, compliance, SLA, and support.
- Billing: no Stripe until onboarding and support burden are predictable.
- License: do not move wholesale to AGPL. Clarify component boundaries first, then choose permissive SDKs plus a reviewed server license.
