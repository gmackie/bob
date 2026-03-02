# Headless Chat + Terminal Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add a first-class chat-driven, headless interaction mode for agent sessions while preserving the existing web-terminal interaction path. The chat path should support interactive decisions (option cards, custom responses, defaults, timeout resolution), session-aware workflows, and a transport abstraction that can later host additional voice providers cleanly (including ElevenLabs).

**Architecture:** Keep terminal interactions in the current dashboard terminal surface and gateway-backed PTY/runtime path. Add a chat orchestration layer in Next.js that creates/starts/reuses conversation sessions in `chatConversations`, routes user inputs through the same runtime services via pluggable transports, and renders workflow events as structured UI actions in `apps/nextjs/app/chat`.

**Tech Stack:** Next.js (App Router), tRPC, Gateway WS protocol, PostgreSQL via `@bob/db`, Playwright, existing `workflowStatusService`, and `@elevenlabs/client` for future voice transport.

## Non-Goals

- Migrating to Vite/vnext/Vinext.
- Rebuilding the dashboard terminal experience.
- Replacing existing instance/process management architecture.
- Adding model-specific behavior beyond transport-layer abstraction.

## Success Criteria

- Existing terminal-based agent sessions continue functioning with no behavior change.
- Chat page can create/start/headless-control sessions for supported agents (non-PTY + PTY).
- Option prompts surfaced from workflow state render as clickable/keyboard-accessible choices in chat.
- Selecting an option or entering custom text closes the awaiting-input cycle and appends a resolution event to the session stream.
- ElevenLabs integration remains isolated to a transport layer and can be swapped/extended without changing chat core.

## Phase 0 — Current-state hardening

### Task 0.1: Validate baseline behavior and identify regressions

**Files:**
- `apps/nextjs/e2e/specs/workflow-transitions.spec.ts`
- `apps/nextjs/e2e/fixtures/ws-mock.ts`
- `apps/nextjs/src/app/chat/page.tsx`
- `apps/nextjs/src/app/chat/_components/message-stream.tsx`
- `apps/nextjs/src/app/chat/_components/session-header.tsx`

**Step 1: Write failing baseline check for current gap**

```ts
import { expect, test } from "../fixtures/test-setup";

test("chat page handles awaiting_input state payload in stream", async ({ page }) => {
  await page.goto("/chat?session=..."); // helper fixture with seeded session/events
  // Assert awaiting input card is present after state payload
});
```

**Step 2: Run it to verify it fails**

Run: `pnpm -F @bob/nextjs test:e2e --grep "awaiting_input"`

**Step 3: Capture current behavior baseline**

- Verify session list create + message send path works with current DB-only session rows.
- Verify `session_created` WS event is never required today in chat flow.

## Phase 1 — Gateway/session persistence integration

### Task 1.1: Wire gateway session lifecycle to `chatConversations`

**Files:**
- `apps/gateway/src/index.ts` (replace TODOs with real DB-backed callbacks)
- `apps/gateway/src/index.ts` (`validateToken` may remain stubbed in this phase)
- `apps/gateway/src/persistence/PersistenceWriter.ts` (already present; hook start/stop)
- `packages/db/src/schema.ts` (no schema change yet)

**Step 1: Add explicit session persistence callbacks in gateway**

Pseudocode:

```ts
const sessionManagerCallbacks = {
  async createSession(config) {
    const [row] = await db.insert(chatConversations).values({
      userId: config.userId, agentType: config.agentType, workingDirectory: config.workingDirectory,
      worktreeId: config.worktreeId, repositoryId: config.repositoryId,
      status: "provisioning",
    }).returning();
    return mapToSessionRecord(row);
  },
  async loadSession(sessionId) {
    return rowToSessionRecord(await db.query.chatConversations.findFirst(...));
  },
  async onSessionStatusChange(sessionId, status) {
    await db.update(chatConversations).set({ status }).where(eq(chatConversations.id, sessionId));
  },
  async updateSessionLease(...) { ... }, releaseSessionLease(...)
};
```

**Step 2: Run typecheck**

Run: `pnpm -F @bob/gateway typecheck`

Expected: PASS.

**Step 3: Run minimal smoke for session creation round-trip**

Use local gateway startup + quick websocket probe script to create session via WS `create_session` and verify DB row appears in `chatConversations` and initial `sessionEvents` row is persisted.

**Step 4: Commit**

```bash
git add apps/gateway/src/index.ts apps/gateway/src/persistence/PersistenceWriter.ts
git commit -m "feat(gateway): persist session lifecycle to database"
```

## Phase 2 — Add chat-specific session lifecycle API

### Task 2.1: Add deterministic session bootstrap flow for chat UI

**Files:**
- `packages/api/src/router/session.ts`
- `apps/nextjs/src/app/chat/_components/session-list.tsx`
- `apps/nextjs/src/trpc` (generated clients use new mutation automatically)

**Step 1: Add `session.getInteractionConfig` / `session.bootstrapForChat` mutation**

```ts
bootstrapForChat: protectedProcedure
  .input(z.object({
    repositoryId: z.string().uuid().optional(),
    worktreeId: z.string().uuid().optional(),
    workingDirectory: z.string(),
    agentType: z.string(),
    title: z.string().max(256).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const created = await ctx.db.insert(chatConversations).values({...}).returning();
    const gatewayInfo = { url: GATEWAY_URL.replace(/^http/, "ws"), shouldStartOnConnect: true };
    return { sessionId: created[0].id, gateway: gatewayInfo };
  });
```

Goal: chat creation must create a durable record that gateway can join/own.

**Step 2: Update session list create path to call bootstrap**

Replace the current plain `session.create` call with `session.bootstrapForChat` for all chat-initiated sessions.

**Step 3: Add regression test for `session.bootstrapForChat`**

- Add a unit test in `packages/api/src/router/__tests__/session.test.ts` (or existing suite in your workspace) that checks:
  - inserted row fields (`status`, `agentType`, `workingDirectory`)
  - returns gateway connect metadata

Run: `pnpm -F @bob/api test -- workflow`.

**Step 4: Commit**

```bash
git add packages/api/src/router/session.ts
git commit -m "feat(api): add chat bootstrap session mutation"
```

### Task 2.2: Add session start guard in chat message dispatch

**Files:**
- `apps/nextjs/src/app/chat/page.tsx`
- `apps/nextjs/src/hooks/use-session-socket.ts`

**Step 1: Ensure connect flow calls create_session when needed**

When a chat session is selected:
- if no active gateway actor is known and session status is `stopped|provisioning`, send WS `create_session` with working directory + agent type.

**Step 2: Add integration test**

E2E test: create session in chat list, wait for `session_created`, then send input and receive at least one `output_chunk`/`message_final` event.

**Step 3: Run**

Run: `pnpm -F @bob/nextjs test:e2e --grep "chat session bootstrap"`.

## Phase 3 — Workflow input UI in chat stream

### Task 3.1: Centralize workflow event extraction and actions

**Files:**
- `apps/nextjs/src/app/chat/page.tsx`
- `apps/nextjs/src/app/chat/_components/session-header.tsx`
- `apps/nextjs/src/app/chat/_components/awaiting-input-card.tsx`
- `apps/nextjs/src/app/chat/_components/message-stream.tsx`
- `apps/nextjs/src/app/chat/_components/session-list.tsx`

**Step 1: Add workflow state query and state merging**

Use existing `session.getWorkflowState` query and merge with ws event stream. Display the workflow badge in header and choose mode-specific helper text.

**Step 2: Extend stream parser to preserve `awaitingInput` context**

When parsing incoming `state` events with payload `workflowStatus` + `awaitingInput`, emit a synthetic event shape usable by UI components.

**Step 3: Add awaiting input action component under message stream**

Reuse `AwaitingInputCard` with:
- options row (buttons + keyboard handling)
- custom input field
- default timeout indicator
- submission via `session.resolveAwaitingInput`.

**Step 4: Add API-backed UI round trip test**

- mock workflow payload push through WS `state` event
- click option / custom value
- assert `resolveAwaitingInput` mutation called with `{ type: "human", value: ... }`
- assert card disappears and workflow transitions back to `working`.

**Step 5: Commit**

```bash
git add apps/nextjs/src/app/chat/_components/awaiting-input-card.tsx apps/nextjs/src/app/chat/_components/message-stream.tsx apps/nextjs/src/app/chat/page.tsx
git commit -m "feat(chat): render and resolve workflow awaiting-input prompts"
```

### Task 3.2: Improve composer affordances for decision mode

**Files:**
- `apps/nextjs/src/app/chat/_components/input-composer.tsx`
- `apps/nextjs/src/app/chat/_components/session-header.tsx`

**Step 1: Disable/enable composer based on workflow state**

- disable freeform composer when waiting on option input unless fallback custom response is enabled
- add microcopy for "Awaiting your choice..." states.

**Step 2: Add Playwright test with keyboard-only flow**

- Ensure Enter/Space on focused option works.

## Phase 4 — Add transport abstraction for headless interaction

### Task 4.1: Define interaction adapter contracts

**Files:**
- `apps/nextjs/src/lib/agents/types.ts` (new)
- `apps/nextjs/src/lib/agents/agentTransports/gateway.ts` (new)
- `apps/nextjs/src/lib/agents/agentTransports/opencode.ts` (new)
- `apps/nextjs/src/lib/agents/agentTransports/index.ts` (new)
- `apps/nextjs/src/app/chat/page.tsx`

**Step 1: Create `AgentTransport` interface**

```ts
export interface AgentTransport {
  start(sessionId: string, session: SessionContext): Promise<void>;
  sendInput(sessionId: string, payload: string): Promise<number>;
  stop(sessionId: string): Promise<void>;
}
```

**Step 2: Implement gateway transport**

- use existing `use-session-socket` for PTY-capable agents.
- fallback to existing `session.create/session.getGatewayWebSocketUrl` flow.

**Step 3: Implement opencode transport**

- use `session.handleVoiceTranscript`/`session.getGateway...` path only where PTY not required.
- ensure all outputs are persisted via existing `recordEvent` mutation.

**Step 4: Wire transport selection by agent type**

- map `agentType` to transport (non-PTY to opencode-like path, PTY to gateway).

**Step 5: Add unit test**

- add adapter contract tests in `apps/nextjs/src/lib/agents/__tests__/agentTransports.spec.ts`.

**Step 6: Commit**

```bash
git add apps/nextjs/src/lib/agents apps/nextjs/src/app/chat/page.tsx
git commit -m "feat(chat): add transport abstraction for headless chat"
```

## Phase 5 — ElevenLabs as pluggable future transport

### Task 5.1: Decouple voice session from chat composition

**Files:**
- `apps/nextjs/src/hooks/use-voice-session.ts`
- `packages/api/src/services/voice/elevenlabsSession.ts`
- `packages/api/src/router/session.ts`
- `apps/nextjs/src/app/chat/_components/input-composer.tsx`

**Step 1: Add `voice` as explicit transport channel in chat**

- when `agentType === "elevenlabs"`, route control through dedicated transport object.
- expose a single `start/stop/sendTurn` contract.

**Step 2: Move transcript persistence to transport callback interface**

- preserve existing insert logic but route through callback hook from transport instead of UI direct wiring.

**Step 3: Add plugin seam**

- define where future SST/TTS providers plug in (e.g., `createAudioTransport`, `sendAudioChunk`, `playbackTranscript`) without touching chat core.

**Step 4: Regression tests**

- existing `packages/api/src/services/voice/__tests__/elevenlabsSession.test.ts` remains green.
- run `pnpm -F @bob/api test --elevenlabs` and targeted e2e check for `start/stop` controls.

## Phase 6 — Finish, hardening, and cleanup

### Task 6.1: Remove orphaned/legacy chat-vs-session creation mismatch

**Files:**
- `apps/nextjs/src/app/api/v1/chat/conversations/route.ts`
- `apps/nextjs/src/app/api/v1/chat/completions/route.ts`
- `packages/api/src/router/chat.ts`
- `apps/nextjs/src/app/chat/page.tsx`

**Step 1: Ensure every chat-initiated flow uses one canonical session source**

- deprecate ad-hoc conversation creation in `/api/v1/chat/conversations/route.ts` or align it to user-aware, chatConversations-backed context.

**Step 2: Add guardrails for auth context**

- no more fallback `"default-user"` writes from public routes in chat paths.

### Task 6.2: Add end-to-end regression pack

**Files:**
- `apps/nextjs/e2e/specs/` (new + updated files)

**Test set (minimum):**
- terminal-mode smoke unchanged (existing spec baseline)
- create and run headless chat session
- stream output arrives and is rendered
- awaiting_input option selection works
- custom resolution input works
- session timeout auto-resolve path from state payload is shown as resolved card

Run:
- `pnpm -F @bob/api test`
- `pnpm -F @bob/nextjs test:e2e`
- `pnpm -F @bob/gateway typecheck`

### Task 6.3: Optional migrations and docs

**Files:**
- `docs/plans/*` (this plan + changelog note)
- `docs/architecture/*` (if needed)

**Step 1: Document interaction modes**
- update docs to explicitly state terminal mode and headless mode behavior differences.

## Risks and Mitigations

- **Gateway and API session ownership divergence**  
  Mitigation: enforce one session source and add DB assertions in gateway callback paths.
- **Event ordering and seq conflicts**  
  Mitigation: keep authoritative `nextSeq` updates in one path; add tests for duplicate seq insert prevention.
- **UX mismatch (chat composer enabled during prompts)**  
  Mitigation: disable input states based on workflow state and show explicit action prompt.
- **Non-PTY runtime drift**  
  Mitigation: keep transport-specific e2e paths and maintain existing fallback to gateway for PTY agents.

## Execution Options

Plan complete and saved to `docs/plans/2026-03-02-headless-chat-dual-interaction-plan.md`.  

1. **Subagent-Driven (this session)** — dispatch one task to focused execution, review between tasks.  
2. **Single-thread execution** — implement sequentially with manual review checkpoints in this same session.
