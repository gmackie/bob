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
