# BizPulse Success Metrics Dashboard

**Date:** 2026-05-31
**Status:** Draft
**Issue:** GMA-21

## Overview

BizPulse is in the prototype phase, so the success metrics dashboard should prove whether users can reach repeated business insight quickly before optimizing for monetization. The dashboard should be small enough to instrument with the workspace-level analytics tooling already available, while leaving room for the funnel definition to become first-class once event coverage is in place.

## North Star Metric

**Weekly Activated Workspaces (WAW):** count of unique production workspaces that complete at least one qualified insight loop in a calendar week.

**Formula:**

```
WAW = count_distinct(workspace_id)
where qualified_insight_loop_completed = true
and event_time is within the reporting week
```

**Qualified insight loop definition:** a workspace completes the loop when a user connects or refreshes a business data source, views an insight or health check generated from that data, and records an explicit next step within 24 hours.

**Required event evidence:**

- `data_source_connected` or `data_source_refreshed`
- `insight_viewed` or `health_check_viewed`
- `next_step_created`, `recommendation_accepted`, or `alert_rule_created`

**Denominator:** all eligible production workspaces with at least one active member during the reporting week. Active member means a signed-in user who opens BizPulse or triggers a tracked workspace action.

**Exclusions:**

- Internal, demo, QA, seed, and test workspaces.
- Workspaces without a completed onboarding state.
- Bot, synthetic, migration, and backfill events.
- Duplicate loops from the same workspace in the same reporting week.
- Events missing `workspace_id`, `environment`, or `event_time`.

**Prototype rationale:** revenue and referral signals will lag during the prototype. WAW measures the earliest durable value promise: BizPulse turns connected business data into a concrete decision or operational follow-up. It is workspace-based instead of user-based because the product value accrues to a business workspace, not just an individual session.

## Input Metrics Tree

### Acquisition

- **Visitor to signup rate:** `signup_started / landing_page_viewed`.
- **Signup completion rate:** `signup_completed / signup_started`.
- **Qualified workspace creation rate:** `workspace_created / signup_completed`.
- **Source mix:** workspaces by `utm_source`, `utm_campaign`, `referrer`, and invite source.
- **Gap:** acquisition quality is only approximated until workspace intent, company size, and source attribution are consistently captured.

### Activation

- **Onboarding completion rate:** `onboarding_completed / workspace_created`.
- **Data connection rate:** workspaces with `data_source_connected / onboarding_completed`.
- **First insight time:** p50 and p90 minutes from `workspace_created` to first `insight_viewed`.
- **Qualified insight loop completion rate:** workspaces with a qualified insight loop / onboarded workspaces.
- **Setup failure rate:** workspaces with `data_source_connection_failed / data_source_connection_started`.
- **Gap:** the prototype needs explicit distinction between sample data, imported data, and live integrations to avoid overcounting activation.

### Retention

- **Weekly returning activated workspace rate:** workspaces with a qualified insight loop this week and at least one prior activated week / prior-week activated workspaces.
- **Health check revisit rate:** workspaces with `health_check_viewed` in consecutive weeks / workspaces with health checks enabled.
- **Alert engagement rate:** `alert_opened / alert_sent`.
- **Next-step follow-through rate:** `next_step_completed / next_step_created`.
- **Gap:** retention will be noisy until workspace-level identity, members, and notification delivery events are stable.

### Revenue

- **Pricing intent rate:** `pricing_viewed / activated_workspace`.
- **Trial start rate:** `trial_started / pricing_viewed`.
- **Upgrade request rate:** `upgrade_requested / activated_workspace`.
- **Paid conversion rate:** `subscription_started / trial_started`.
- **Gap:** revenue metrics are leading indicators only until packaging, billing, and plan enforcement are implemented.

### Referral

- **Invite rate:** workspaces with `member_invited / activated_workspace`.
- **Invite acceptance rate:** `member_invite_accepted / member_invited`.
- **Share rate:** workspaces with `insight_shared / activated_workspace`.
- **Referral signup rate:** `signup_completed` where `signup_source = referral`.
- **Gap:** referral quality is unknown until shared insight links and invite attribution preserve source workspace and recipient outcome.

## Instrumentation Checklist

Use the existing analytics package entry points, such as `trackEvent` on web and `trackEventNative` on native, to capture these events with consistent workspace-level properties.

### Global Properties

- `workspace_id`
- `user_id`
- `environment`
- `app_surface`
- `account_type`
- `workspace_created_at`
- `is_internal`
- `is_demo`
- `plan_tier`
- `utm_source`
- `utm_campaign`
- `referrer`

### Minimal Tracking Plan

| Hypothesis                                                                           | Event                                                                                                               | Required properties                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Users with a clear source complete signup at a measurable rate.                      | `landing_page_viewed`                                                                                               | `utm_source`, `utm_campaign`, `referrer`                                                               |
| Users can create a business workspace without assistance.                            | `signup_started`, `signup_completed`, `workspace_created`                                                           | `signup_method`, `workspace_id`, `company_size`, `role`                                                |
| Activation depends on finishing onboarding.                                          | `onboarding_started`, `onboarding_completed`                                                                        | `workspace_id`, `onboarding_version`, `step_count`, `duration_seconds`                                 |
| BizPulse value depends on connected or refreshed business data.                      | `data_source_connection_started`, `data_source_connected`, `data_source_connection_failed`, `data_source_refreshed` | `workspace_id`, `source_type`, `integration_name`, `failure_reason`, `latency_ms`                      |
| The first useful moment is an insight or health check generated from workspace data. | `insight_viewed`, `health_check_viewed`                                                                             | `workspace_id`, `insight_id`, `insight_type`, `data_source_count`, `generated_at`, `freshness_minutes` |
| A qualified loop requires explicit action, not passive viewing.                      | `next_step_created`, `recommendation_accepted`, `alert_rule_created`, `next_step_completed`                         | `workspace_id`, `insight_id`, `action_type`, `owner_user_id`, `due_date_set`, `completion_status`      |
| Retention is driven by repeat health checks and alerts.                              | `alert_sent`, `alert_opened`, `workspace_revisited`                                                                 | `workspace_id`, `alert_type`, `channel`, `health_score`, `days_since_last_visit`                       |
| Revenue readiness appears before payment wiring is final.                            | `pricing_viewed`, `trial_started`, `upgrade_requested`, `subscription_started`                                      | `workspace_id`, `plan_tier`, `billing_period`, `seat_count`, `conversion_source`                       |
| Referral loops appear through invited teammates and shared insights.                 | `member_invited`, `member_invite_accepted`, `insight_shared`, `referral_signup_completed`                           | `workspace_id`, `invite_role`, `share_channel`, `source_workspace_id`, `recipient_domain`              |

### Health Check Metrics

- **Tracking completeness:** percent of activation events with `workspace_id`, `user_id`, `environment`, and `event_time`.
- **Event freshness:** p95 ingestion delay from event time to dashboard availability.
- **Identity join rate:** percent of events that can be joined to a known workspace and member.
- **North star integrity:** percent of WAW-qualified loops with all required event evidence present.

## Review Cadence

### Weekly KPI Review

- **Owner:** BizPulse product lead.
- **Attendees:** product, engineering, GTM, and customer-facing owner for active prototype users.
- **Timing:** weekly, using the most recent complete calendar week.
- **Inputs:** WAW, AIRRR input metrics, health check metrics, top degraded segments, and notable user feedback.
- **Decisions:** one instrumentation fix, one funnel improvement, and one customer-learning action for the next week.

### Escalation Rules

- **North star degradation:** if WAW falls more than 20% week over week, or declines for two consecutive weeks, open a product and engineering review within one business day.
- **Activation degradation:** if qualified insight loop completion falls below 30% of onboarded workspaces, prioritize onboarding or data connection fixes before new acquisition work.
- **Instrumentation degradation:** if tracking completeness drops below 95% or north star integrity drops below 90%, treat dashboard readings as suspect and fix instrumentation before interpreting the funnel.
- **Reliability degradation:** if event freshness p95 exceeds 60 minutes for a complete business day, notify engineering and annotate the dashboard for the affected period.
- **Revenue or referral anomaly:** if upgrade, invite, or share events spike by more than 50% without matching activation movement, audit event duplication and attribution before changing GTM tactics.
