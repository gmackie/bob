# Host-turn admission, history, and recovery

Host turns start a fresh subscription-provider session with the full canonical
branch-visible transcript through the originating user event. A stored native
session ID is provenance only. Credential homes and their provider artifacts
remain disposable; a runner must not resume from an ID after removing those
artifacts. Older gateways may still include `runtimeSession` in claims; the
worker deliberately ignores it. Restoring native resume requires independent
durable-artifact and exact-lineage acceptance evidence.

## Admission and crashes

Context preparation completes and persists before a host execution is inserted.
The insertion attaches that context in the same transaction that publishes
`queued`. Unique owner/idempotency and user-event keys choose one logical
execution and one context pack under concurrent requests. A lost response after
commit is replayed from that execution. A crash before commit leaves no admitted
work; resending the original command retries preparation.

This deliberately uses atomic post-preparation admission instead of introducing
another preparation status, renewable lease and reconciler. It does not need a
schema migration. Concurrent preparation or a crash after context persistence
can leave an unused context pack; it is not an accepted run or a source for a
subsequent claim. Expired unused packs can be inventoried for a separately
reviewed retention cleanup; never delete referenced packs or fabricate missing
provenance.

## Pre-upgrade queued rows without context

No background sweep silently reissues historical commands. Before rollout,
inventory `ooda.host_turn_executions` where `status = 'queued'` and
`context_pack_id IS NULL`, including owner ID, conversation ID, user-event ID,
idempotency key and command fingerprint. Keep the inventory private. Verify the
referenced conversation and original user event still exist and belong to the
stored owner. Do not substitute another owner or a later user event.

Replay the **original** command through the authenticated owner's
`POST /api/v1/host-turns` (`host.createTurn`) using its conversation ID,
user-event ID and idempotency key. Use the normal configured context sources.
If reconstructing the input does not match the stored command fingerprint,
stop and retain the row for explicit investigation; do not invent omitted
input or rewrite the fingerprint.

Replay prepares context, then locks the existing execution. It attaches context
only while the row is still queued with a null context. Concurrent replayers
return the winner's pack; a slow preparer cannot replace a claimed attempt's
context. Verify the returned receipt has a context-pack ID and the same
execution ID, then verify a runner claims it. Missing source events, ownership
mismatches, and preparation failures remain explicit repair failures. Existing
running/terminal rows are never reopened by this repair.

A reclaimed execution increments its attempt and rotates its lease token.
Completion from a stale runner/token must reject rather than overwrite the
current attempt.

## Proposal decision clocks

New approvals sample server time after locking the owned proposal. Expiry at or
before that instant rejects. Proposal updates, approval events and outbox
availability/creation use this authoritative time. The submitted `decidedAt`
remains audit information in the approval decision and `clientDecidedAt` in the
outbox payload; it cannot backdate authorization or delay delivery. An identical
already-accepted decision still replays after expiry. Changed decisions conflict.
