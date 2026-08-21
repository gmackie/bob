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

1. Bob validates the versioned Hermes intent.
2. Bob calls `POST /api/v1/hermes/capture` with an owner-scoped OODA API key.
3. OODA derives the owner from that key, appends one personal `user_turn`, and returns an opaque event receipt.
4. Bob writes a categorized `hermes_usage` journal record. The record contains a keyed request digest and fixed enums, never message text.
5. Skillfleet's existing replay-safe workflow-journal collector validates, batches, and uploads the record.

Retries reuse the original request ID. OODA returns the original event with `replayed: true`; Skillfleet records the replay outcome separately from a new successful capture.

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
