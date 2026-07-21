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
