# Hermes operator policy

Hermes is a conversational client of Bob, OODA, Skillfleet, and ForgeGraph. It does not become a second system of record.

## Supported daily loop

| Intent     | Owner      | Risk | Effect                   | Evidence rule                                                                                                            |
| ---------- | ---------- | ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `today`    | Bob        | R0   | Read                     | Preserve source counts, timestamps, partial coverage, and missing sources.                                               |
| `capture`  | OODA       | R1   | Accepted user write      | Append one `user_turn` event using the transport request ID as the idempotency key. Do not create a task or memory seed. |
| `research` | OODA       | R1   | Private bounded work     | Read-only research job; no external writes.                                                                              |
| `work`     | Bob        | R2   | Proposal only            | Present owner, scope, repositories, acceptance, cost, and risk.                                                          |
| `approve`  | Bob        | R3   | Approval only            | Bind one actor to the exact proposal scope digest and expiry.                                                            |
| `status`   | Bob        | R0   | Read                     | State missing proof explicitly; a build is not an installation or live-runtime proof.                                    |
| `fleet`    | Skillfleet | R0   | Read or dry-run proposal | Telegram never applies fleet changes.                                                                                    |
| `close`    | OODA       | R0   | Private reflection       | Completed, blocked, waiting, and captured statements require canonical evidence; tomorrow items require proposals.       |
| `stop`     | Bob        | R3   | Emergency control        | Pause automation and return recovery instructions.                                                                       |

The public contract lives in `@gmacko/bob/contracts`. Unknown fields fail closed. Actor identity is derived by the authenticated boundary and is never accepted from the operator payload.

## Capture path

`POST /api/v1/hermes/operator` is the authenticated Bob ingress. It requires a Bob bearer API key, the configured owner user ID, and `write` permission for `capture` (`read` for read-only intents). Missing or invalid keys return 401, cross-owner keys return 403, malformed or excess payload fields return 400, and intentionally unwired intents return 501.

1. Bob validates the versioned Hermes intent and derives the actor from the API key.
2. Bob calls OODA `POST /api/v1/hermes/capture` with an owner-scoped OODA API key.
3. OODA derives the owner from that key, appends one personal `user_turn`, and returns an opaque event receipt.
4. Bob writes a replay-safe row to `hermes_usage_events`. The row contains HMAC request and actor digests plus database-constrained categories, never message text, identity, request ID, or raw path.
5. A Skillfleet export/collector adapter may read this categorical ledger; that adapter is not yet presented as live.

Retries reuse the original request ID. OODA returns the original event with `replayed: true`; Skillfleet records the replay outcome separately from a new successful capture.

The operator route requires `HERMES_OPERATOR_OWNER_USER_ID`, `HERMES_OODA_ORIGIN_URL`, `HERMES_OODA_API_KEY`, `HERMES_OODA_CONVERSATION_ID`, `HERMES_OODA_BRANCH_ID`, and `HERMES_USAGE_DIGEST_SECRET`. Bob work-item, OODA, Skillfleet, and ForgeGraph readers are wired when their corresponding runtime settings are present. Missing sources remain named gaps, terminal Bob work-item state alone is partial release evidence, and an incompletely configured intent fails closed instead of fabricating a complete result.

## Daily delivery

Morning and evening objects are deterministic for `kind + UTC date`. They use the existing delivery-ledger claim states (`new`, `retry`, `processed`, `pending`, `conflict`) before a Hermes job is scheduled. A failed schedule remains retryable. A processed claim is returned as deduplicated.

Initial schedules are explicit fixed preferences. Calendar-aware or learned scheduling is deferred until the 14-day text-only dogfood has evidence.

## Approval boundary

An approval is usable only when all of the following hold:

- the approval is active and unexpired;
- its ID has not been consumed;
- its SHA-256 scope digest exactly matches action class, owner, target, and parameter digest;
- execution remains in the owning system.

Every state-changing action crosses four strict public envelopes:

1. `inspection` records the exact owner, scope, observation time, and canonical evidence.
2. `proposal` binds that inspection to a stable scope digest and explicit validity window.
3. `execution` binds one proposal and one approval to an idempotency key before the effect begins.
4. `receipt` binds the outcome back to the execution, proposal, approval, owner, scope digest, idempotency key, approval expiry, and canonical result evidence.

Approval consumption is persisted before execution in `hermes_approval_consumptions`. Primary and unique constraints make approval ID, execution ID, and idempotency key single-use across processes and restarts. A concurrent or later replay fails closed rather than re-running the effect.

Telegram may present and record approvals, but it does not receive shell, credential, deployment, computer-use, or writable-infrastructure capabilities.

## Proof and rollout

For 14 consecutive days record morning use, capture use, outcome, replay, evidence coverage, and unwanted proactive messages. Success requires no lost accepted capture, duplicate durable object, unapproved external write, secret disclosure, or hidden evidence gap. Content, identities, raw paths, transcript text, responses, and arbitrary model names never enter fleet telemetry.
