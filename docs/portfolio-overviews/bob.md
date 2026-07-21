# Portfolio overview: Bob

**Source:** BizPulse (`pulse agent context --json`, `pulse growth review --json`) with `--startup 0583c96c-7f53-47de-917c-da7b41e7ea7c`. Passing `--startup bob` fails CLI validation (UUID required); resolve IDs via `pulse startup list --json` or `pulse status --json`.

**Lifecycle stage:** **prototype**, portfolio role **internal_tool**, **internal_only** under **Gmacko LLC**. Pulse describes Bob as multi-instance AI agent orchestration (Claude, Kiro, Codex, Gemini) across repos and worktrees—not startup-track.

**Health grade:** **C** (**needs-attention**), composite **ops score 42** as of **2026-07-08**. Dimensions feeding Pulse: financial **20**, reliability **95**, infrastructure **40**, and operational **21**; product, compliance, and growth still have no scorecard evidence.

**Key metrics:** **No KPI object**. Required setup checklist (`pulse startup setup bob`) is **2/8 ready**: ForgeGraph and Sentry are ready; Cloudflare is connected but waiting on first sync; domain, PostHog, Twenty, Stripe, and QuickBooks still block full setup. Current connector states: Stripe **auth_failed** (last successful sync **2026-05-31**), Linear **connected**, Twenty **auth_failed**, Cloudflare **connected** with no successful sync, Sentry **connected** (last successful sync **2026-07-08T00:43:52Z**), ForgeGraph **connected** (last successful sync **2026-07-08T00:43:53Z**), PostHog **disconnected**.

**Required-system configuration evidence:** Repo-owned deployment config already identifies the primary production domain as **bob.blder.bot** (`apps/bob/wrangler.jsonc` route and `FRONTEND_URL`). ForgeGraph app wiring is declared in `.forgegraph.yaml`: app **bob**, server **https://forgegraf.com**, production node **hetzner-master**, staging node **labnuc**, deploy target **Cloudflare Workers**, worker **blder-bot**, healthcheck path `/`. Sentry and ForgeGraph syncs completed successfully on **2026-07-08**. Cloudflare worker routing is configured in repo, but the Pulse first-sync attempt on **2026-07-08** failed with **“Cloudflare API token not configured”**.

**Top bottleneck:** **Growth review**: no urgent bottleneck. Practically the gap is required-system credential state in Pulse: Pulse has no primary domain value even though the repo route is `bob.blder.bot`; Cloudflare lacks a usable API token for sync; PostHog is disconnected; Twenty and Stripe credentials fail auth; QuickBooks OAuth is not configured.

**Recommended next action:** Update the Pulse startup record with primary domain **bob.blder.bot**, then add or rotate the missing startup/workspace credentials: Cloudflare API token/account context, PostHog project routing, Twenty managed CRM auth, Stripe account context/product mapping, and QuickBooks OAuth grant. After credentials are present, run `pulse sync cloudflare bob`, `pulse sync posthog bob`, `pulse sync twenty bob`, `pulse sync stripe bob`, `pulse sync quickbooks bob`, and `pulse sync sentry bob`.
