# OODA Personal OS: Phase 1 migration rehearsal

Date: 2026-08-05

This is the verification receipt for the first implementation batch. No production schema or conversation rows were mutated.

## Implemented surface

- Strict, versioned Zod contracts under `packages/ooda/src/contracts/v1` for conversations, events, context disclosure, memory, jobs, proposals/approvals, integrations, and problems.
- OODA-owned PostgreSQL schema with 16 canonical tables for conversation/event history, memory/attention, jobs/context, proposals/approvals, and delivery/outbox repair.
- Native `vector(1536)` memory embeddings with an HNSW cosine index; no new bytea embeddings.
- Additive migrations `0006_clean_viper.sql` and `0007_wet_surge.sql`, plus an explicit pre-cutover rollback that removes only the new `ooda` schema.
- Idempotent legacy research backfill and independent verification commands.
- OpenAPI repair for the pre-existing Bob dispatch output-schema failure.

## Restored-production migration proof

The Phase 0 Bob archive was restored into an isolated pgvector/PostgreSQL 17 container. The migrations were applied there, then the legacy backfill was executed twice.

Both executions and the independent verification command returned:

| Check | Source | Destination | Result |
|---|---:|---:|---|
| Conversations | 38 | 38 | pass |
| Root branches | 38 | 38 | pass |
| Provider jobs | 63 | 63 | pass |
| Conversation events | 356 | 356 | pass |
| Provider job events | 356 | 356 | pass |
| Transcript hash | `827bea056f0f37dddd5c16ee375b3c9b` | `827bea056f0f37dddd5c16ee375b3c9b` | pass |
| Terminal-sequence hash | `29b48319cd5e3f27a16e2c5520cba2c8` | `29b48319cd5e3f27a16e2c5520cba2c8` | pass |

Original research-thread, runner-session, and session-event UUIDs are preserved in the destination records and explicit migration metadata. Legacy provider `thought` events remain recoverable but are classified `restricted`, preventing ordinary context or TTS disclosure.

## Rollback proof

The migration created exactly 16 OODA tables. The rollback removed the `ooda` schema and all of its dependent objects. Exact legacy counts for `research_thread`, `chat_conversations`, and Bob `session_events` matched before migration, after migration, and after rollback.

## Automated verification

- `pnpm --filter @gmacko/ooda typecheck`: pass.
- `pnpm --filter @gmacko/ooda test`: 543 passed, 6 skipped, 0 failed.
- `drizzle-kit generate` after the checked-in snapshots: no schema changes.
- `git diff --check`: pass.

The local shell is Node 22.22.0 while the repository requires Node 24+. The tests and typecheck pass despite that warning; CI and runner verification must use Node 24 before merge.
