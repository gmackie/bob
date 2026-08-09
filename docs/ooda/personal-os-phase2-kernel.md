# OODA Personal OS — Phase 2 kernel evidence

Date: 2026-08-05

Branch: `feat/ooda-personal-os`

Base Phase 1 commit: `715108545c2df6cfbb2866baaa4a404ac08b62d1`

## Delivered slice

- Strict V1 command, result, detail, list, and cursor-page contracts for conversations and events.
- OODA-owned conversation creation idempotency and branch-command idempotency in generated Drizzle migration `0008_ooda_kernel_idempotency.sql`.
- Owner-scoped create, list, retrieve, fork, archive, append, correct, and paginate kernel operations.
- Transactional sequence allocation on the conversation row and conflict recovery through the canonical event idempotency index.
- Immutable corrections and ancestry-aware branch timeline reconstruction.
- Deterministic timeline, search, inbox, daily-review, and active-work projection rebuilds.
- Read-only compatibility translation for legacy research threads and runner-session events.
- Matching Node and edge tRPC procedure trees.
- Matching versioned HTTP resources backed by the typed tRPC/OpenAPI contracts.
- Resumable authenticated SSE using `Last-Event-ID` or `afterSequence`, canonical sequence event IDs, bounded edge-friendly connections, and V1 problem events.

## Verification evidence

The focused PostgreSQL 17/pgvector test used a disposable container with migrations 0006–0008 applied to an empty OODA schema.

- 24 simultaneous unique appends produced exactly sequences 1 through 24 with no duplicates.
- 12 simultaneous retries using one idempotency key produced one event ID, one non-replay receipt, and `lastSequence = 1`.
- Reusing an idempotency key with changed content returned `IDEMPOTENCY_CONFLICT`.
- Corrections preserved the source event and changed only projected effective content.
- Cursor pages produced no duplicate conversation IDs.

Current gates:

- `pnpm --filter @gmacko/ooda test`: 555 passed, 12 skipped, 0 failed.
- Focused real-PostgreSQL kernel suite: 6 passed, 0 failed.
- `pnpm --filter @gmacko/ooda typecheck`: passed.
- `pnpm --filter @gmacko/ooda-web typecheck`: passed.
- `pnpm --filter @gmacko/ooda-edge typecheck`: passed.
- `pnpm --filter @gmacko/ooda-edge build`: passed and classified both `/api/v1/:path+` and `/api/v1/conversations/:conversationId/events/stream` as API routes.

## Existing Node build blocker

`pnpm --filter @gmacko/ooda-web build` still fails during Turbopack resolution of pre-existing `.js`-suffixed TypeScript workspace imports (for example `packages/core/src/auth/index.ts` importing `./api-keys.js`, and `packages/ooda/src/api/router/bob.ts` importing `./bob-config.js`). The build reaches and emits the new stream route chunk before reporting 21 workspace-resolution errors. Type checking and the equivalent Vinext edge production build pass. This is a web-build configuration blocker, not a kernel contract or stream-runtime failure, and should be handled before Node deployment proof.
