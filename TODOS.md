# TODOS

## Rate limiting / backoff for batch Linear issue creation

**Status:** Deferred (post-PR1)
**Priority:** P2
**Depends on:** LinearPlanningProvider.createTask() in PR1

When batch dispatch creates 10-50 tasks for a Linear-backed project, add exponential
backoff and partial failure handling. Linear has rate limits (~1500 req/hour per API key).
Without backoff, a burst of 20+ createIssue calls can fail mid-batch.

Requirements:
- Exponential backoff on 429 responses from Linear API
- Partial failure handling: report which tasks succeeded and which failed
- User-visible batch progress (X of N created, Y failed)
- Idempotency keys (already planned for PR1) make retries safe

Context: Codex flagged this as a critical gap for batch creation. Single-task creation
(planning one task at a time) works fine without backoff. Batch dispatch is the risk.

## pgbouncer in front of hetzner-master Postgres

**Status:** Deferred (own workstream — shared ForgeGraph infra, not Bob code)
**Priority:** P2
**Depends on:** nothing; deployable any time
**Added:** 2026-07-12 (/plan-eng-review of the Bob production v1 design)

**What:** Deploy pgbouncer (transaction pooling) in front of Postgres on hetzner-master
so ForgeGraph's ~100-connection steady state and Bob's gateway/worker/cron connections
share a bounded pool.

**Why:** The 2026-07-06 incident (error 53300, ws-gateway crash loop) was connection
exhaustion at max_connections=200; the bump to 400 postpones the ceiling rather than
removing it. Bob production v1 adds an outbox worker, an Expo receipts cron, and a
sessionEvents retention job — all new connection consumers on the same box.

**Where to start:** pgbouncer on hetzner-master alongside Postgres (its own volume at
/mnt/HC_Volume_105211366); repoint DATABASE_URL-style secrets through the pooler.

**Caveats:** prepared statements under transaction pooling — verify postgres.js and
drizzle settings (postgres.js `prepare: false` or use session pooling for the few
long-lived consumers). Roll out one consumer at a time; the runtime Hyperdrive path
has its own pooling and may not need to move.

**Rejected alternative:** folding this into the Bob production v1 slice — mixed blast
radius (shared ForgeGraph dependency inside an already-XXL Bob build).

## Agent credential management in the UI (auth mechanism)

**Status:** DONE (2026-08-29) — shipped in `feat/agent-credential-ui`
**Design:** https://4arxrpftggrm.postplan.dev
**Priority:** P1

**What shipped, and where it differed from the plan below:**
- The read path already existed end-to-end (`probeCliProvider` -> `collectHostSnapshot`
  -> relay -> dashboard), so this was a missing *write* path plus one missing status,
  not a new health surface.
- The daemon already runs as the credential-owning user (`bob-execution.service`:
  `User=bob`, `HOME=/home/bob`, `ProtectHome=false`), so the security caveat below was
  already solved by the process topology. Nothing new needed privileges.
- No PTY needed: all three device-auth flows emit their URL over plain pipes
  (verified against the installed CLIs), so `node-pty` was dropped. That matters
  because the deploy installs deps on the build machine and rsyncs them to Linux.
- `no_credit` is latched from real run outcomes and persisted to disk, because the
  daemon is `Restart=always` — an in-memory latch would report `ready` ten seconds
  after any crash.
- The circuit breaker trips only on CONFIRMED evidence, never on the statistical
  inference in `agentHealthRouter.ts`, which reconciles it with that file's
  deliberate "a broken runner must not stop dispatch entirely" decision.

---

_Original entry:_
**Depends on:** nothing; `agentHealthRouter.ts` + `agent-health.js` already exist
**Added:** 2026-08-29 (found while wiring the BizPulse venture backlog into the task runner)

**What:** A first-class auth surface in the Bob UI — per node, per agent — showing
credential state and letting an operator re-authenticate from the browser instead of
SSHing to the box. Natural homes are `apps/bob/src/app/(dashboard)/nodes` (per-node
agent roster) and `apps/bob/src/app/(dashboard)/settings`.

**Why:** Every agent-outage postmortem in this repo ends at the same wall — the
runtime can *detect* a dead agent but can never *fix* one. `assessAgentHealth()`
infers unhealth from recent outcomes, so it only reacts after the damage: 392 review
sessions burned in 24h on 2026-08-23 (codex, expired ChatGPT auth), and a quarter of
all dispatches wasted on 2026-08-21 until a human hand-edited
`BOB_AUTO_DRAIN_AGENTS`. `pickHealthyAgent()` routes around one dead agent, but it
degrades to "keep the configured one" when nothing is healthy.

That degenerate case is now the live case. On 2026-08-29 all three agents on
hetzner-bob were down at once:

| agent | state | detail |
|---|---|---|
| claude | `auth_needed` | "OAuth session expired and could not be refreshed" |
| codex  | `auth_expired` | "OAuth token revoked — re-login required" |
| grok   | reports `ok`  | dies on every run: `402 Payment Required — Grok Build usage balance exhausted` |

With zero healthy agents there is nothing to route to. The task runner claimed work,
spawned grok, got exit 1 in ~1s, marked the issue `no_changes`, posted a "produced no
changes" comment, reset it to `unstarted`, and repeated every 120s across the whole
backlog. The only remedy today is `ssh hetzner-bob` → `agent-auth.sh <agent>` as user
`bob`, which means outages persist for as long as nobody happens to be at a terminal.
This one ran 8 days.

**Where to start:**
- Model at least three states, not a boolean. Grok passed the health check and still
  failed every run, because `/opt/bob/scripts/agent-health.js` validates *auth* and
  never *balance*. Suggested: `authed` / `expired` / `no_credit` / `unknown`, with
  the provider's own error surfaced verbatim (the 402 body named the exact problem).
- Read the same signal the CLI does — reuse `agent-health.js` rather than adding a
  second source of truth that can disagree with the runner.
- Device-code flow is the piece that makes this work in a browser: `grok login
  --device-auth` already exists in `agent-auth.sh`, and both `claude login` and
  `codex login` emit a URL. The UI shows the code/link, polls, confirms.
- Surface it where the operator already looks — a red badge on the node, plus
  whatever the digest/starvation alerts feed, so a dead credential is visible without
  reading journald.

**Caveats:**
- Credential files live under the `bob` user (`~/.claude/.credentials.json`,
  `~/.codex/auth.json`) with 0600. A UI-triggered auth has to land there as `bob`,
  not as the web process — this is the security-sensitive part of the design and
  should get a look from whoever owns `docs/security`.
- Never render a token; state and expiry only.
- Balance/quota is a billing fact, not an auth fact. Re-auth won't fix a 402, so the
  UI should say "top up", not "sign in", or operators will loop on the wrong action.

**Rejected alternative:** just alerting louder on credential expiry. BizPulse already
proves alerting alone is insufficient — its watchdog correctly flagged the dead runner
every hour for 8 days into a void (`RESEND_API_KEY` unset, so every send returned
false). Detection without a remediation path is what produced this outage; the point
of this work is the fix button, not the notification.
