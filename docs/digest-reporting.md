# Durable digest reporting (BOB-34)

Apply `0035_digest_destinations.sql` with the normal `@bob/db migrate` runner before deploying. Both tables are additive. PGlite bootstrapping includes the same schema definitions.

A destination is scoped by workspace, tracker endpoint, and team. A database reservation permits at most one create; the issue is created directly in a canceled state. One persisted delivery reservation per UTC date permits at most one comment write. `force` bypasses the time-of-day gate only; it never bypasses date deduplication.

The first successful lookup adopts a stable existing digest card. Every historical card retains its comments and original description, receives a link to the canonical history, and is kept canceled. The canonical description links every historical card. Migration is safe to rerun, includes archived records, and reads all issue/comment pages. Existing local imports are canceled within the workspace; the importer and autoDrain also exclude the title and reporting marker.

Metrics retain their definitions but are scoped through the destination workspace's work items. Notifications link directly to the canonical history. No Slack or email is sent.

## Delivery failures

Lookup errors throw into the existing cron error reporting; they never authorize creating a new card. HTTP 401/403/429 permits a later retry. A timeout, 5xx, malformed reply, or GraphQL error may follow a committed write, so it leaves the reservation in `sending`. Later runs reconcile the issue/history or daily comment before attempting anything else.

If no remote record can be found, investigate rather than resetting automatically. Only reset a reservation to `ready` after proving the write did not commit and no request remains in flight. Link a recovered issue to its destination, or mark a verified existing daily comment `posted`. Never bulk-reset reservations. This is an intentional limit of a tracker API without atomic idempotency keys.

Tracker endpoint/team changes use a separate namespace. They do not move old history across integrations. The old destination remains persisted for audit.

## Verification

The tests exercise concurrent reservation and publication against PGlite, lost issue/comment responses, retryable failures, legacy history migration, per-date suppression, tracker pagination, canceled creation, and autoDrain selection exclusion.
