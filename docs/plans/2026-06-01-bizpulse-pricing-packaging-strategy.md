# BizPulse Pricing & Packaging Strategy

**Issue:** GMA-18
**Date:** 2026-06-01
**Status:** Hypothesis, not a billing implementation plan

## Decision

Choose the **individual founder** as the first buyer model.

BizPulse should sell to the person who feels the pain directly: an indie founder already paying for AI coding tools and trying to keep multiple product bets moving without adding process overhead. That buyer can adopt self-serve, tolerate a hypothesis-stage product, and does not require procurement, SSO, invoicing, usage pooling, or formal seat management.

Do not start with a studio-seat or portfolio-seat package. Studios introduce collaborator management and client/workspace boundaries before the prototype has proved repeated founder value. Portfolio operators are attractive later, but they need cross-company reporting, permissions, and consolidated billing that would force billing and org-model work too early.

## Packaging Hypothesis

Use market-facing names **Starter**, **Pro**, and **Team** while keeping the current `tenant_plan` implementation shape (`free`, `premium`, `pro`) until pricing is validated.

| Market tier | Current plan value |                           Hypothesis price | Buyer promise                                                        | Feature gates                                                                                                                                                                 | Roadmap timing                                               |
| ----------- | ------------------ | -----------------------------------------: | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Starter     | `free`             |                                         $0 | Try the workflow on one product bet.                                 | 1 workspace, BYOK agents, planning pipeline, basic run history, local-only agent config, manual artifact review.                                                              | Live during invite/waitlist and Phase 1/2 onboarding.        |
| Pro         | `premium`          |                $19/mo founder, test $29/mo | Run BizPulse as the daily founder cockpit.                           | Unlimited personal workspaces, longer run/artifact history, priority planning/review workflows, GitHub issue intake, richer observability summaries, exportable weekly pulse. | Introduce once Phase 3 close-the-loop works end-to-end.      |
| Team        | `pro`              | $49/mo base + $15/member, test $79/mo base | Bring a small studio or cofounder team into the same operating loop. | Shared workspaces, member roles, team activity feed, multi-seat access, team-level privacy controls, Slack/webhook notifications, higher artifact retention.                  | Defer to Phase 4 expansion after solo founder WTP is proven. |

Pricing should remain feature-based, not LLM-usage-based. BizPulse users bring their own agent and model credentials, so the paid line should be collaboration, observability, retention, and workflow confidence rather than token volume.

## Competitive Anchors

Sources checked on 2026-06-01:

| Product                                                     |                                                                                                                                        Anchor | Caveat for BizPulse                                                                                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cursor](https://cursor.com/pricing)                        |                                                                                                          Pro at $20/mo; Teams at $40/user/mo. | Cursor sells an AI coding environment with bundled model usage. BizPulse should not match usage entitlements because users bring their own keys and agents.                                                   |
| [GitHub Copilot](https://github.com/features/copilot/plans) | Free individual usage exists; Copilot Pro is positioned for individuals, while Business/Enterprise add org management, policy, and indemnity. | Copilot is a model-backed coding assistant with massive distribution. It is a ceiling for perceived AI-dev-tool value, not a direct workflow/observability comp.                                              |
| [Linear](https://linear.app/pricing)                        |                                                                      Basic at $10/user/mo, Business at $16/user/mo annual, Enterprise custom. | Linear prices work management seats at a lower ARPU and gates team/process features. BizPulse can anchor higher than Linear for founders only if it proves agent-run confidence and weekly operating insight. |
| [Sentry](https://sentry.io/pricing/)                        |                                        Developer is free for one user; Team starts at $26/mo with unlimited users; Business starts at $80/mo. | Sentry is a stronger observability analog than a planning analog, but it is event-volume-based. BizPulse should borrow the "free solo, paid operational confidence" shape without adding event metering yet.  |

Initial Pro should sit near Cursor Pro and Sentry Team because the product is founder workflow plus observability, not a generic issue tracker. Team should stay below full AI-seat pricing at first because team value is unproven and billing is deliberately lightweight.

## Experiment Plan

### Willingness-to-pay snippets

Use these snippets in founder calls, waitlist replies, and checkout-intent modals. Do not show them as finalized public pricing until conversion data exists.

- "If BizPulse reliably turned agent runs into a weekly founder pulse across your active projects, would $19/month feel like an easy yes, a maybe, or too much?"
- "At what price would you expect this to be serious enough to trust with your product workflow: $9, $19, $29, or $49/month?"
- "Which would you rather pay for: unlimited personal workspaces, longer artifact history, GitHub issue intake, or a weekly investor/cofounder update?"
- "If you brought in a contractor or cofounder, would you expect to pay per person, per workspace, or a flat small-team fee?"
- "What would make you cancel after the first month: inaccurate summaries, too much setup, weak GitHub integration, missing team sharing, or price?"

### Onboarding survey

Add these as optional onboarding questions before any billing prompt:

1. "What are you using BizPulse for first?" Options: one SaaS product, multiple indie products, client/studio work, internal team workflow.
2. "Who else needs to see the output?" Options: just me, cofounder, contractor, client, investor/advisor.
3. "How many active repos or product bets do you want tracked?" Options: 1, 2-3, 4-10, more than 10.
4. "Which outcome matters most this week?" Options: know what agents changed, catch broken work, plan next tasks, summarize progress, coordinate people.
5. "What are you already paying for?" Options: Cursor, Copilot, Claude Code, Linear, Sentry, none, other.

### Promo and test pricing guardrails

- Use founder-limited promos, not permanent discounts: "first 25 founders keep $19/mo for 12 months" is acceptable; lifetime deals are not.
- Test one variable at a time: Pro price ($19 vs $29) or Team base price ($49 vs $79), not both in the same cohort.
- Never discount below $9/mo for Pro. Below that, support and founder attention cost more than the signal is worth.
- Do not gate safety, auditability, or trust controls behind paid tiers. Paid gates can be retention, sharing, integrations, and reporting depth.
- Keep all agent execution autonomy defaults aligned with the current policy direction: local user-owned agent configs, explicit trust for per-repo config, and ForgeGraph-owned lifecycle/approval transitions. Paid plans must not imply "more autonomous writes" without the same approval gates.
- No usage overages until infrastructure and support can explain them clearly. If limits are needed, use soft product limits such as workspaces, retention windows, and team members.
- A user who downgrades keeps read access to existing run artifacts for a grace period; writes and new retention stop at the lower tier.

## Success Metrics

- Starter to Pro intent: at least 20% of activated founders select a paid-intent answer at $19/mo.
- Pro conversion: at least 5 paid founders or 10 explicit "invoice me when ready" commitments before implementing full Stripe plan management.
- Team pull: at least 3 founders ask to invite another person before building Team billing.
- Packaging clarity: fewer than 20% of onboarding respondents choose "other" for primary use case after two survey iterations.

## Non-Goals

- No new billing UI for GMA-18.
- No Stripe price creation or subscription migration.
- No portfolio-seat plan until solo founder and small-team demand are proven.
- No token, run, or event metering in the first pricing test.
