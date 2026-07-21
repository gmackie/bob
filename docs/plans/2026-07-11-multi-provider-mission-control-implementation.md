# Multi-provider Mission Control Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run Claude, Codex, Grok, and Cursor Agent through the Bob host daemon while exposing honest provider capabilities, usage, limits, health, and controls to web and mobile clients.

**Architecture:** Add a versioned provider-adapter contract inside `@bob/execution`, publish host/provider snapshots through the existing Bob WebSocket protocol, and persist normalized run telemetry through the existing runtime mirror. Extend the existing web and tablet mission-control models rather than building a parallel dashboard.

**Tech Stack:** TypeScript, Vitest, Node child processes, WebSocket, Zod, React/Next.js, Expo/React Native, Maestro, systemd, PostgreSQL.

---

### Task 1: Define the provider capability and telemetry contract

**Files:**
- Create: `apps/bob-execution/src/providers/contract.ts`
- Create: `apps/bob-execution/src/providers/contract.test.ts`
- Modify: `apps/bob-execution/src/runtime/index.ts`

**Steps:**

1. Write failing tests for supported providers, capability normalization, usage source precedence, stale snapshots, and explicit unavailable limits.
2. Run `pnpm -F @bob/execution test -- src/providers/contract.test.ts` and confirm failure because the contract does not exist.
3. Add `ProviderId`, `ProviderCapabilities`, `ProviderUsageSnapshot`, `ProviderHealthSnapshot`, and normalizers that preserve `provider`, `bob_metered`, and `estimated` provenance.
4. Re-run the focused test and `pnpm -F @bob/execution typecheck`; expect both to pass.
5. Commit with `feat(execution): define provider capability contract`.

### Task 2: Implement CLI probes and structured stream parsers

**Files:**
- Create: `apps/bob-execution/src/providers/cli-provider.ts`
- Create: `apps/bob-execution/src/providers/cli-provider.test.ts`
- Create: `apps/bob-execution/src/legacy/agents/grok-adapter.ts`
- Create: `apps/bob-execution/src/legacy/agents/grok-adapter.test.ts`
- Modify: `apps/bob-execution/src/legacy/agents/agent-factory.ts`
- Modify: `apps/bob-execution/src/legacy/types.ts`
- Modify: `apps/bob-execution/src/legacy/utils/agentPaths.ts`
- Modify: `apps/bob-execution/src/legacy/agents/usage-parsing.ts`

**Steps:**

1. Add fixtures/tests for Claude stream JSON, Codex JSONL, Grok streaming JSON, and Cursor stream JSON, including malformed lines and missing usage.
2. Add failing probe tests for installed/version/authenticated/unavailable states without reading secret values.
3. Run the focused tests and confirm the missing Grok adapter/probe failures.
4. Implement side-effect-injected CLI probes and provider parsers; register `grok` in the legacy factory and command lookup.
5. Ensure probes return degraded capabilities instead of throwing on unknown CLI versions.
6. Run all `@bob/execution` tests and typecheck; expect green.
7. Commit with `feat(execution): add four-provider CLI probes`.

### Task 3: Route daemon execution through provider adapters

**Files:**
- Create: `apps/bob-execution/src/providers/runtime.ts`
- Create: `apps/bob-execution/src/providers/runtime.test.ts`
- Modify: `apps/bob-execution/src/daemon/index.ts`
- Modify: `apps/bob-execution/src/runtime/taskExecutor.ts`

**Steps:**

1. Write failing tests for command construction, native session IDs, usage events, cancellation, and unsupported follow-up/approval controls.
2. Run the focused test and verify it fails before implementation.
3. Move provider command selection and JSONL parsing out of the daemon switch into the provider runtime.
4. Emit normalized lifecycle/usage events while retaining raw provider payloads for diagnostics.
5. Make cancellation idempotent and capability-gate controls.
6. Run execution tests, typecheck, and daemon build; expect green.
7. Commit with `refactor(execution): use provider runtime in daemon`.

### Task 4: Publish host and provider snapshots through the gateway

**Files:**
- Modify: `packages/bob/src/ws/src/protocol.ts`
- Modify: `packages/bob/src/ws/src/__tests__/client.test.ts`
- Modify: `apps/bob-ws-gateway/src/protocol.test.ts`
- Modify: `apps/bob-ws-gateway/src/index.ts`
- Modify: `apps/bob-execution/src/daemon/index.ts`

**Steps:**

1. Add failing protocol tests for versioned host identity, daemon version, provider health/capability snapshots, queue depth, sequence acknowledgement, and replay metadata.
2. Run `pnpm -F @bob/ws-gateway test` and the WS package tests; confirm schema/type failures.
3. Extend heartbeat and hello messages with backward-compatible optional snapshot fields.
4. Have the daemon probe providers at startup and periodically, publishing secrets-free snapshots.
5. Persist the latest host snapshot in the gateway and return it to authorized observers.
6. Run gateway and WS tests/typechecks; expect green.
7. Commit with `feat(gateway): publish host provider health`.

### Task 5: Persist normalized usage and expose it through Bob APIs

**Files:**
- Modify: `packages/bob/src/agents/src/schema.ts`
- Modify: `packages/bob/src/api/src/router/publicApi.ts`
- Create: `packages/bob/src/api/src/router/provider-capacity.test.ts`
- Modify: `apps/bob-execution/src/runtime/bobRuntimeMirrorSidecar.ts`
- Modify: `apps/bob-execution/src/runtime/bobRuntimeMirrorSidecar.test.ts`

**Steps:**

1. Write failing API and sidecar tests for source, freshness, reset window, unavailable quota, observed tokens, interrupted runs, and workspace isolation.
2. Run focused tests and confirm failures.
3. Add the smallest compatible storage fields/table required for provider capacity snapshots and migration metadata.
4. Accept normalized usage events in the runtime mirror and expose workspace-scoped provider capacity plus host health.
5. Confirm no API ever converts observed usage into a guessed remaining quota.
6. Run focused API/execution tests and typechecks; expect green.
7. Commit with `feat(api): expose provider capacity snapshots`.

### Task 6: Extend web mission control to all four providers and hosts

**Files:**
- Modify: `apps/bob/src/components/dashboard/mission-control-model.ts`
- Modify: `apps/bob/src/components/dashboard/__tests__/mission-control-model.test.ts`
- Modify: `apps/bob/src/components/dashboard/provider-runs-model.ts`
- Modify: `apps/bob/src/components/dashboard/__tests__/provider-runs-model.test.ts`
- Modify: `apps/bob/src/components/dashboard/provider-capacity-cards.tsx`
- Modify: `apps/bob/src/components/dashboard/mission-control.tsx`

**Steps:**

1. Write failing model tests for Claude/Codex/Grok/Cursor, host selection, stale/unavailable labels, and capability-gated controls.
2. Run the dashboard tests and confirm failures.
3. Generalize the existing Codex/Cursor model without adding a second dashboard.
4. Render host state, provider auth/version, reported allowance, Bob-observed usage, reset/freshness, and supported controls.
5. Run focused tests, Bob typecheck, and a production build under Node 24.
6. Commit with `feat(web): add multi-provider mission control`.

### Task 7: Extend mobile mission control and Maestro coverage

**Files:**
- Modify: `apps/mobile-bob/src/features/tablet/dashboard.ts`
- Modify: `apps/mobile-bob/src/features/tablet/dashboard.test.ts`
- Modify: `apps/mobile-bob/src/components/tablet/TabletProviderPane.tsx`
- Modify: `apps/mobile-bob/src/components/tablet/TasksDashboard.tsx`
- Create: `apps/mobile-bob/.maestro/06-multi-provider-mission-control.yaml`
- Create: `apps/mobile-bob/.maestro/07-live-agent-control.yaml`

**Steps:**

1. Write failing model tests for all four provider cards, honest telemetry labels, host state, and accessible control labels.
2. Run the focused mobile test and confirm failures.
3. Generalize provider grouping and render host/provider/usage state with deterministic accessibility IDs.
4. Add Maestro flows for authenticated mission-control visibility and a real seeded/live control path.
5. Run all mobile tests, lint, and typecheck; expect green.
6. Commit with `feat(mobile): add multi-provider mission control`.

### Task 8: Add repeatable host deployment and verification

**Files:**
- Modify: `apps/bob-execution/bob-execution.service`
- Modify: `apps/bob-execution/deploy-hetzner-bob.sh`
- Create: `scripts/verify-bob-provider-host.mjs`
- Create: `scripts/verify-bob-provider-host.test.ts`
- Create: `docs/ops/multi-provider-host-setup.md`

**Steps:**

1. Write failing verifier tests for CLI absence, wrong service user auth, stale heartbeat, failed harmless run, missing usage, cancellation, and replay.
2. Implement a secrets-safe verifier and parameterized host deployment instructions.
3. Run verifier tests and shell syntax checks.
4. Deploy to `hetzner-bob`; install/authenticate all four CLIs as the service user using browser/device flows where required.
5. Run one harmless task per provider, cancellation, and reconnect/replay; save sanitized evidence.
6. Commit with `ops: verify multi-provider execution hosts`.

### Task 9: Prove deployed web and mobile end to end

**Files:**
- Modify as failures require, always adding a regression test first.
- Update: `docs/ops/multi-provider-host-setup.md`

**Steps:**

1. Deploy the Bob backend/gateway/web bundle and record current versions.
2. Using the existing Chrome session at `bob.blder.bot`, verify host status, four provider states, a real streamed run, follow-up/control, and final usage.
3. Build/install the mobile app on an Android emulator and run the two mission-control Maestro flows.
4. Build/install the mobile app on an iPhone simulator and run the same flows.
5. Fix each discovered defect via red-green-refactor and repeat the affected proof.
6. Run the full focused regression bundle and record exact evidence in the runbook.
7. Commit with `test: prove multi-provider mission control e2e`.
