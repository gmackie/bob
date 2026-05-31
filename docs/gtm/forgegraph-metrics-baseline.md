# ForgeGraph Success Metrics and Measurement Baseline

Issue: GMA-47  
Owner: Gmacko  
Status: Initial baseline, reviewed once in-document  
Last reviewed: 2026-05-31

ForgeGraph is a prototype. Treat GTM metrics as directional until PostHog is unblocked or an interim event sink is live. Pulse can confirm operational health, but it does not currently explain acquisition, trial activation, or retention.

## North-Star Metric

**Weekly retained deploying clusters**: unique clusters that complete at least one successful staging or production deployment in a week and had at least one successful deployment in a prior week.

This ties the GTM motion to the core promise for indie DevOps and self-hosted PaaS users: ForgeGraph is working when real clusters keep shipping software through it.

## Supporting Metrics

| Metric               | Definition                                                                                    | Primary source                                                                            | Current read                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Successful deploys   | Count of `forge_deployments` that reach `healthy`, split by `staging`, `prod`, and `preview`. | ForgeGraph deployment DB / `forgeDeployments` via `packages/api/src/router/forgegraph.ts` | Partially available as operational data. Needs product/account attribution before GTM reporting.     |
| Time to first deploy | Time from first self-host/trial start to first `healthy` staging or prod deployment.          | Trial signup/install event plus `forge_deployments.deployedAt`                            | Not available end-to-end. Missing acquisition/trial start event.                                     |
| Retained clusters    | Clusters with successful deploys in week N and any successful deploy in week N-1 through N-4. | ForgeGraph deployment DB plus cluster/app identity                                        | Partially inferable if cluster identity is stable. Needs explicit cluster/app identity in analytics. |

## Funnel

| Stage             | Definition                                                                            | Owner               | Data source                                                                           | Minimum success signal                                       |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Awareness         | Visitor reaches ForgeGraph site, docs, GitHub repo, or OSS announcement.              | GTM owner           | PostHog web analytics, GitHub traffic, referral params                                | Qualified visitor or repo star/watch from target audience.   |
| Trial / self-host | User starts install, runs setup, imports an app, or connects a cluster.               | Product/DevRel      | PostHog CLI/docs event, ForgeGraph app list/import events, install logs               | Setup started and at least one app or cluster registered.    |
| Active usage      | User completes build and healthy deploy through ForgeGraph.                           | Product/Engineering | ForgeGraph `forge_revisions`, `forge_builds`, `forge_deployments`, `forge_run_events` | First healthy staging or prod deployment.                    |
| Expansion         | User adds another app/cluster, repeats weekly deploys, or moves from staging to prod. | GTM owner + Product | ForgeGraph deployment DB, app/cluster count, billing/CRM when available               | Retained weekly deploying cluster or additional app/cluster. |

## Minimum Instrumentation

PostHog is the preferred product analytics path once the project limit issue is resolved. The repo already has a PostHog wrapper in `packages/analytics/src/web/index.tsx`, but `packages/config/src/integrations.ts` currently sets `posthog: false`. Until PostHog is available, write the same event names to an interim table, log pipeline, or warehouse export so the schema does not change later.

Required events:

| Event                              | When                                                    | Required properties                                                                             | Preferred source                       |
| ---------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| `forgegraph_awareness_visit`       | Site/docs/GitHub CTA visit.                             | `source`, `campaign`, `path`, `anonymous_id`                                                    | PostHog web/docs.                      |
| `forgegraph_setup_started`         | User starts install, CLI setup, or self-host bootstrap. | `anonymous_id`, `workspace_id?`, `install_method`, `version`                                    | CLI or setup flow.                     |
| `forgegraph_app_registered`        | App/repo is registered or imported.                     | `workspace_id`, `app_id`, `repo_provider`, `cluster_id?`                                        | ForgeGraph app API / Bob import flow.  |
| `forgegraph_build_completed`       | Build finishes.                                         | `workspace_id`, `app_id`, `cluster_id?`, `build_id`, `status`, `duration_ms`                    | Existing `forge_builds`.               |
| `forgegraph_deploy_completed`      | Deployment reaches terminal state.                      | `workspace_id`, `app_id`, `cluster_id`, `deployment_id`, `environment`, `status`, `duration_ms` | Existing `forge_deployments`.          |
| `forgegraph_weekly_active_cluster` | Weekly rollup for retained cluster reporting.           | `cluster_id`, `workspace_id`, `successful_deploy_count`, `environments`                         | Scheduled rollup over deployment data. |

Current gaps vs Pulse:

- Pulse covers operational signals only; it is not a product funnel source.
- PostHog web/native wrappers exist, but PostHog is disabled by config and disconnected by project limit.
- Existing ForgeGraph tables can report builds, deployments, and run events, but they do not cover awareness, install start, or trial source.
- Cluster identity and account/workspace attribution must be stable before retained cluster metrics can be trusted.
- Time-to-first-deploy needs a trial start timestamp, not just deployment timestamps.

## Weekly Review Cadence

Review every Monday for 30 minutes in the ForgeGraph GTM project page or equivalent Linear project notes.

Agenda:

1. North-star trend: weekly retained deploying clusters.
2. Funnel conversion by stage: awareness, trial/self-host, active usage, expansion.
3. Instrumentation gaps and data quality issues.
4. Learnings from demos, support, Discord/GitHub, and self-host attempts.
5. One decision for the next week: keep, change, or pause the current GTM push.

Capture notes as dated entries below until there is a dedicated Linear page.

## 30 / 60 / 90 Day Targets

These are operating ranges for learning, not promises.

| Horizon | Target ranges                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| 30 days | 3-8 qualified self-host trial starts, 1-3 first healthy staging deploys, baseline dashboard or interim query live. |
| 60 days | 8-20 qualified trial starts, 3-7 active deploying clusters, median time-to-first-deploy directionally visible.     |
| 90 days | 15-40 qualified trial starts, 5-12 weekly retained deploying clusters, 2-5 teams/apps showing expansion behavior.  |

## Review Notes

### 2026-05-31 Initial Review

- Accepted weekly retained deploying clusters as the north-star because it combines deploy success with repeat usage.
- Kept supporting metrics to successful deploys, time-to-first-deploy, and retained clusters to avoid over-measuring before instrumentation lands.
- Confirmed Pulse is not enough for GTM measurement; it only covers operational health.
- PostHog remains the preferred path, with an interim analytics sink acceptable if it preserves the event schema above.
- Next action: unblock PostHog or create an interim event table/export for setup, app registration, and deploy completion events.
