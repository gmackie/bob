# Phase 6E — `@gmacko/agent` (CLI subprocess orchestrator)

`@gmacko/agent` manages agent sessions by spawning CLI subprocesses (`claude`, `codex`, or a Cursor agent over ACP — 6E ships the Claude Code CLI adapter; the others land in follow-up phases implementing the same interface). Each turn = one `claude -p ... --output-format stream-json` subprocess. gmacko parses the NDJSON event stream, projects it into `chat_messages` rows, and emits an `AgentEvent` stream to in-process consumers.

**This is a dramatic pivot from the original master-plan scope** (which assumed direct Anthropic SDK calls). `@anthropic-ai/sdk` leaves the package. `packages/agent/src/dispatch.ts` becomes dead code and is deleted.

## Scope

**In scope (locked):**
- Drop `@anthropic-ai/sdk` dep; delete existing `dispatch.ts`.
- Adapter interface `AgentAdapter` — contract all CLI adapters implement.
- Tagged-union `AgentEvent` schema for stream output.
- NDJSON parser for Claude Code `--output-format stream-json` lines.
- `ClaudeCodeCliAdapter` — canonical invocation: `claude --bare -p <prompt> --output-format stream-json [--resume <id>] [--allowedTools ...] [--append-system-prompt ...] [--no-session-persistence]`. Spawns via `node:child_process.spawn`, parses stdout, exposes `Stream<AgentEvent>`.
- Subprocess lifecycle via `Effect.acquireRelease`: acquire = spawn; release = `SIGTERM` (escalate to `SIGKILL` after 500 ms if still alive).
- Queue-based stream producer: parser writes to `Queue.bounded(256)`, consumers read via `Stream.fromQueue`, `Queue.shutdown` signals end.
- `MockAdapter` — in-memory, deterministic event sequence for tests. Implements `AgentAdapter` with scripted events + optional failure injection.
- `AgentSession` Effect service — 4 methods: `create`, `sendTurn`, `cancel`, `close`. Tenant-scoped via explicit `{ tenantId, userId }`.
- Transcript persistence — atomic `SELECT MAX(seq) + 1` per-turn write batch into `chat_messages`. Role mapping per Option B: `user` for input, `assistant` for accumulated text, `tool` for each tool_use/tool_result event (metadata carries structured payload).
- `chat_conversations.adapterId = "claude-code"` + `metadata.externalSessionId` stores Claude Code's returned `session_id` for `--resume`.
- SIGINT cancellation: set session status `canceled`, write a marker tool-role row with `{type:"canceled"}` in metadata.
- Public barrel + `layerAgent` (requires `GmackoDb`).

**Deferred:**
- `CodexCliAdapter`, `CursorAcpAdapter`, `AgentSdkAdapter` — implement the same `AgentAdapter` interface in follow-up phases.
- RPC group (`AgentRpc`) — 6J app wiring.
- Per-tenant API keys via `@gmacko/secrets` — 6E uses `ANTHROPIC_API_KEY` from env only.
- `projectId` on `chat_conversations` — no schema change in 6E; add when project-scoped conversation UX lands.
- Prompt caching configuration — Claude Code CLI handles caching internally; gmacko has nothing to configure.
- `session_secret_usages.sessionId → chat_conversations.id` FK promotion — still deferred; no agent-secret integration in 6E.

## Exit criteria

- **32 packages** (no new packages). `pnpm -r typecheck` green.
- Full test suite ≥ 210 tests passing (up from 189). Expected breakdown:
  - Baseline 6D: 189
  - Task 1 (old-dispatch removal): 0 (deletion)
  - Task 3 (Adapter contract + AgentEvent): +2 (type-level + shape smoke)
  - Task 4 (NDJSON parser): +7 (text_delta, tool_use, tool_result, turn_end, system/init, malformed line, incomplete line buffering)
  - Task 5 (ClaudeCodeCliAdapter unit — parser integration only, no real spawn): +3
  - Task 6 (subprocess lifecycle): +2 (acquire-release, SIGTERM escalation)
  - Task 7 (Queue stream producer): +2
  - Task 8 (MockAdapter): +3
  - Task 9 (AgentSession.create): +3
  - Task 10 (AgentSession.sendTurn + persistence): +5
  - Task 11 (seq allocation + role mapping): already covered by Task 10
  - Task 12 (cancel + close): +3
  - Task 13 (barrel + layer test): +2
  - **Expected total: ~221** (well over 210).
- Real-spawn integration test exists but gated behind `GMACKO_E2E_CLAUDE_CODE=1` env var — not part of the default CI suite (requires `claude` binary + `ANTHROPIC_API_KEY`).
- `pnpm --filter @gmacko/agent test` passes without `claude` binary installed (MockAdapter covers all paths).

## Design decisions (locked)

- **Subprocess-per-turn, not per-session.** Each `sendTurn` call spawns a fresh `claude` subprocess. Multi-turn continuity via `--resume <claudeSessionId>` pulled from `metadata.externalSessionId` on the first turn.
- **Adapter interface is the stable contract.** Swapping Claude Code for Codex or Cursor/ACP means writing a new adapter implementation — `AgentSession` and persistence code never change.
- **Transcript is a projection, not ground truth.** The CLI's session file on disk is the ground truth. gmacko persists a cleaned, schema-conformant projection suitable for UI rendering. We do NOT try to round-trip through the projection.
- **One subprocess per AgentSession fiber at a time.** `sendTurn` returns an Effect that holds the subprocess; starting a new turn while one is in-flight is an error (`TurnInProgressError`).
- **Cancellation shape.** `cancel(sessionId)` interrupts the in-flight turn's fiber; `Effect.acquireRelease`'s release clause sends SIGTERM. Session status transitions to `canceled`. A marker message (`role: "tool", metadata: {type: "canceled"}`) is written so the transcript reflects the interruption.
- **No tool execution in gmacko.** Claude Code CLI handles all tool execution internally. gmacko just observes `tool_use` + `tool_result` events and persists them.
- **Seq allocation.** Per-turn write batch opens a drizzle transaction, does `SELECT MAX(seq) FROM chat_messages WHERE conversationId = $id`, then inserts N messages with `seq = max + 1, max + 2, ...`. Serial-per-session guarantees no conflict; cross-session writes target different conversations.
- **Env inheritance.** Subprocess inherits parent env by default; `ANTHROPIC_API_KEY` flows through. `--bare` ensures no CLAUDE.md / MCP / plugin contamination from the parent's working directory.
- **Working directory.** `spawn`'s `cwd` option sets the subprocess CWD. Callers pass `cwd?: string` on `create` and it's stored in `chat_conversations.metadata.cwd`.
- **Allowed tools list.** Caller passes `allowedTools?: string[]` on `create`; stored in metadata; forwarded to each `--allowedTools` CLI flag on each turn's subprocess. Default: `["Read", "Edit", "Bash"]`.
- **Failure modes.** Non-zero exit (except 130 / SIGINT-triggered) → `AgentExitError { code, sessionId, stderr }`. Malformed NDJSON line → logged, skipped (don't blow up the stream for one bad line). Subprocess never started (e.g. `claude` binary not found) → `AdapterSpawnError`.

## Effect 4 API additions / confirmations

Preemptive drift check found **no new drift rows needed** — all 6E APIs are already established or stdlib:

- `Queue.bounded<A, E = never>(capacity): Effect<Queue<A, E>>` — verified at `effect/dist/Queue.d.ts:316`.
- `Stream.fromQueue<A, E>(dequeue): Stream<A, Exclude<E, Cause.Done>>` — verified at `effect/dist/Stream.d.ts:1031`. **End-of-stream signaled via `Queue.shutdown`**, NOT via a sentinel offer. The `Exclude<E, Cause.Done>` in the signature is how `Cause.Done` (internal "queue closed" cause) gets filtered out of the resulting stream's error channel.
- `Stream.runCollect` / `Stream.runForEach` — tests use `runCollect` to collect emitted events into an array for assertion.
- `Effect.acquireRelease(acquire, release)` — verified at `effect/dist/Effect.d.ts:11097`. Subprocess pattern: `acquire = spawn`, `release = (child, exit) => terminate child`.
- `Effect.scoped(effect)` — extracts `Scope` requirement. The `sendTurn` Effect is `Effect.scoped`-wrapped so the subprocess is guaranteed cleaned up on consumer interruption.
- `Effect.interrupt` is a **value** (`Effect<never>`), not a function. Use as `yield* Effect.interrupt`.
- `node:child_process.spawn` is unchanged from Node's API; interfaces with Effect via `Effect.acquireRelease` + `Effect.async` for process-event bridging.

## Task breakdown

Each task = RED → GREEN → COMMIT. One subagent per task.

### Task 1: Remove `@anthropic-ai/sdk` + delete `dispatch.ts`

- Delete `packages/agent/src/dispatch.ts`.
- Rewrite `packages/agent/src/index.ts` to a 6E sentinel: `export const __gmackoAgentPhase = "6e" as const;`
- Remove `@anthropic-ai/sdk` from `packages/agent/package.json` dependencies.
- Run `pnpm install` to regenerate lockfile.
- Add a smoke test `packages/agent/src/__tests__/package.test.ts` that asserts `__gmackoAgentPhase === "6e"`.

Commit: `chore(agent): drop @anthropic-ai/sdk + delete dispatch.ts (6E pivot to CLI orchestrator)`

### Task 2: Scaffold `@gmacko/agent` deps + vitest

Update `packages/agent/package.json` to mirror the `@gmacko/secrets` shape:
- Dependencies: `effect@4.0.0-beta.43`, `@gmacko/db`, `@gmacko/validators` (workspace).
- DevDependencies: `@gmacko/tsconfig`, `@effect/vitest`, `@electric-sql/pglite`, `@types/node`, `drizzle-orm`, `typescript`, `vitest`.
- Scripts: `test`, `typecheck`.

Mirror `packages/secrets/vitest.config.ts` + `tsconfig.json` exactly.

Commit: `chore(agent): scaffold deps for CLI orchestrator`

### Task 3: `AgentAdapter` contract + `AgentEvent` tagged union

`packages/agent/src/adapter.ts`:
```ts
export type AgentEvent =
  | { readonly type: "session_init"; readonly externalSessionId: string; readonly model: string }
  | { readonly type: "turn_start" }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: "tool_result"; readonly toolUseId: string; readonly content: string; readonly isError: boolean }
  | { readonly type: "turn_end"; readonly stopReason: string }
  | { readonly type: "canceled" };

export interface AdapterTurnInput {
  readonly prompt: string;
  readonly resumeSessionId?: string;   // Claude Code's session_id from prior turns
  readonly systemPrompt?: string;
  readonly allowedTools?: readonly string[];
  readonly cwd?: string;
}

export interface AgentAdapter {
  readonly adapterId: string;  // "claude-code", "codex", "cursor-acp", "mock"
  readonly sendTurn: (input: AdapterTurnInput) => Effect.Effect<Stream.Stream<AgentEvent, AdapterError>, AdapterError, Scope.Scope>;
}

export class AdapterSpawnError extends Schema.TaggedErrorClass<AdapterSpawnError>()(
  "AdapterSpawnError",
  { adapterId: Schema.String, message: Schema.String },
) {}

export class AdapterExitError extends Schema.TaggedErrorClass<AdapterExitError>()(
  "AdapterExitError",
  { adapterId: Schema.String, code: Schema.Number, stderr: Schema.String },
) {}

export type AdapterError = AdapterSpawnError | AdapterExitError;
```

Tests — 2 cases: type-level smoke (file compiles + exports resolve), and `AgentEvent` discriminated-union narrowing via a tiny runtime helper.

Commit: `feat(agent): add AgentAdapter contract + AgentEvent tagged union`

### Task 4: NDJSON parser for `stream-json` lines

`packages/agent/src/stream-json-parser.ts` — pure function(s), no Effect, no subprocess. Translates Claude Code `stream-json` NDJSON lines into `AgentEvent`s.

```ts
export function parseStreamJsonLine(line: string): AgentEvent | null;
// Handles: system/init → session_init; stream_event with event.delta.type in {text_delta, tool_use, tool_result} → corresponding event; turn_start/turn_end → turn events; malformed/unknown → null (caller ignores).

export class StreamJsonBuffer {
  constructor();
  push(chunk: string): readonly AgentEvent[];  // accumulates partial lines, emits events for complete lines
  flush(): readonly AgentEvent[];              // emits any remaining event from pending line
}
```

Tests — 7 cases on the pure parser + buffer:
1. `{"type":"system/init","session_id":"abc","model":"sonnet"}` → `{type:"session_init", externalSessionId:"abc", model:"sonnet"}`
2. `{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}` → `{type:"text_delta", text:"Hi"}`
3. `{"type":"stream_event","event":{"delta":{"type":"tool_use","id":"t1","name":"Read","input":{"path":"/a"}}}}` → `{type:"tool_use", id:"t1", name:"Read", input:{path:"/a"}}`
4. `{"type":"stream_event","event":{"delta":{"type":"tool_result","tool_use_id":"t1","content":"ok","is_error":false}}}` → `{type:"tool_result", toolUseId:"t1", content:"ok", isError:false}`
5. `{"type":"turn_end","stop_reason":"end_turn"}` → `{type:"turn_end", stopReason:"end_turn"}`
6. Malformed JSON line → `null` (do not throw)
7. Buffer: push(`'{"type":"tur`) → [] ; push(`n_start"}\n{"type":"turn_end"}\n`) → [turn_start, turn_end]

Commit: `feat(agent): add stream-json NDJSON parser`

### Task 5: `ClaudeCodeCliAdapter` — wiring parser to subprocess shape

`packages/agent/src/claude-code-adapter.ts`:
```ts
export interface ClaudeCodeAdapterOptions {
  readonly binary?: string;  // default "claude"
}

export const claudeCodeAdapter = (opts: ClaudeCodeAdapterOptions = {}): AgentAdapter => ({
  adapterId: "claude-code",
  sendTurn: ({ prompt, resumeSessionId, systemPrompt, allowedTools, cwd }) =>
    Effect.gen(function* () {
      const args = buildArgs({ prompt, resumeSessionId, systemPrompt, allowedTools });
      // acquireRelease of the subprocess (Task 6)
      // pipe stdout through StreamJsonBuffer (Task 4)
      // return Stream<AgentEvent> (Task 7)
      ...
    }),
});

function buildArgs(input: AdapterTurnInput): string[] {
  const args = ["--bare", "-p", input.prompt, "--output-format", "stream-json", "--no-session-persistence"];
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  if (input.allowedTools && input.allowedTools.length > 0) args.push("--allowedTools", input.allowedTools.join(","));
  if (input.systemPrompt) args.push("--append-system-prompt", input.systemPrompt);
  return args;
}
```

This task ships `buildArgs` + the adapter skeleton. The actual subprocess lifecycle lands in Task 6. Tests for Task 5 are **unit tests of `buildArgs`** — 3 cases proving CSV tool flag, presence/absence of `--resume`, and `--append-system-prompt` forwarding.

Commit: `feat(agent): add ClaudeCodeCliAdapter (args builder + skeleton)`

### Task 6: Subprocess lifecycle via `Effect.acquireRelease`

Fill in the `acquireRelease` portion of `claudeCodeAdapter`:
- `acquire`: `child_process.spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })`. If spawn fails synchronously, fail with `AdapterSpawnError`.
- `release`: on exit/interruption, send SIGTERM; wait 500 ms; if still alive, SIGKILL.

Tests — 2 cases against a trivial subprocess (`node -e "process.stdin.pipe(process.stdout)"` or `cat`):
1. Acquire + release cleanly terminates the subprocess (exit code 0 observed).
2. Interrupting the containing Effect mid-run triggers SIGTERM within 100 ms (observable via `child.killed` or `exit` event).

Commit: `feat(agent): add subprocess lifecycle (acquireRelease + SIGTERM escalation)`

### Task 7: Queue-based stream producer bridging subprocess stdout to `Stream<AgentEvent>`

Fill in the final piece of `claudeCodeAdapter.sendTurn`:
- Inside the scope, create `Queue.bounded<AgentEvent, AdapterError>(256)`.
- `Effect.forkDetach` a task that reads subprocess stdout chunks, feeds them through `StreamJsonBuffer`, and `Queue.offer`s each event.
- When stdout closes AND the child exits:
  - exit code 0 → `Queue.shutdown` (stream ends cleanly via `Cause.Done`)
  - exit code ≠ 0 (and not 130) → `Queue.done(AdapterExitError)` or equivalent; the `Exclude<E, Cause.Done>` in `Stream.fromQueue` ensures non-Done errors surface as stream failures
  - exit code 130 (SIGINT) → emit a final `{type:"canceled"}` event then `Queue.shutdown`
- Return `Stream.fromQueue(queue)`.

Tests — 2 cases via MockAdapter-like fake subprocess (spawn `node -e "process.stdout.write('...ndjson...')"`):
1. Full happy-path event sequence: session_init → turn_start → 3 text_deltas → turn_end ; `Stream.runCollect` returns all 6 events in order.
2. Subprocess exits non-zero → collected stream raises `AdapterExitError`.

Commit: `feat(agent): add Queue-based stream producer for adapter events`

### Task 8: `MockAdapter` for deterministic tests

`packages/agent/src/mock-adapter.ts`:
```ts
export interface MockAdapterScript {
  readonly events: readonly AgentEvent[];
  readonly exitCode?: number;   // default 0
  readonly perEventDelayMs?: number;  // default 0 for synchronous emission
  readonly failSpawn?: boolean;
}

export const mockAdapter = (script: MockAdapterScript): AgentAdapter;
```

Emits the scripted events through the same Queue-based mechanism, then shuts down (or fails) according to `exitCode`/`failSpawn`. No actual subprocess spawn — purely in-memory.

Tests — 3 cases:
1. Scripted 3-event sequence returns those exact events in order via `Stream.runCollect`.
2. `failSpawn: true` → `AdapterSpawnError` surfaced from `sendTurn`.
3. `exitCode: 1` → stream completes with `AdapterExitError` after emitting scripted events.

Commit: `feat(agent): add MockAdapter for deterministic tests`

### Task 9: `AgentSession.create`

`packages/agent/src/agent-session.ts`:
```ts
export class AgentSessionNotFoundError extends Schema.TaggedErrorClass<...>()(...)
export class TurnInProgressError extends Schema.TaggedErrorClass<...>()(...)

export interface CreateSessionInput {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly title?: string;
  readonly adapterId: string;
  readonly systemPrompt?: string;
  readonly allowedTools?: readonly string[];
  readonly cwd?: string;
}

export interface AgentSessionShape {
  readonly create: (input: CreateSessionInput) => Effect.Effect<{conversationId: ChatConversationId}, never>;
  // sendTurn, cancel, close land in later tasks
}

export class AgentSession extends ServiceMap.Service<AgentSession, AgentSessionShape>()(
  "@gmacko/agent/AgentSession",
) {}
```

`create` inserts a `chat_conversations` row with `status: "pending"`, `adapterId`, and `metadata: {systemPrompt, allowedTools, cwd}`. Returns the new `conversationId`.

The layer takes `AgentAdapter` as an argument — NOT as an Effect service — because different sessions may use different adapters at runtime. Pattern:
```ts
export const layerAgent = (adapter: AgentAdapter): Layer.Layer<AgentSession, never, GmackoDb> =>
  Layer.effect(AgentSession)(...);
```

Tests — 3 cases:
1. `create` with minimal input inserts a row with `status="pending"`.
2. `create` returns a `conversationId` matching the inserted row.
3. `create` stores `allowedTools`/`systemPrompt`/`cwd` in `metadata` jsonb.

Commit: `feat(agent): add AgentSession.create (Effect service + layerAgent)`

### Task 10: `AgentSession.sendTurn` + transcript persistence

Add `sendTurn` to the service:
```ts
readonly sendTurn: (input: {
  conversationId: ChatConversationId;
  tenantId: TenantId;
  userId: UserId;
  prompt: string;
}) => Effect.Effect<Stream.Stream<AgentEvent, AdapterError>, AgentSessionNotFoundError | TurnInProgressError | AdapterError, Scope.Scope>;
```

Flow:
1. SELECT the conversation, verify `tenantId`+`userId` match (cross-tenant hardening). Fail with `AgentSessionNotFoundError` on mismatch.
2. If conversation `status = "active"`, fail with `TurnInProgressError`.
3. UPDATE status to `"active"`. Write a `chat_messages` row with `role: "user", content: prompt`. Sequence via `SELECT MAX(seq) + 1 FROM chat_messages WHERE conversationId = $id`.
4. Call `adapter.sendTurn({prompt, resumeSessionId: metadata.externalSessionId, allowedTools: metadata.allowedTools, systemPrompt: metadata.systemPrompt, cwd: metadata.cwd})`.
5. Return a new `Stream` that:
   - Observes every `AgentEvent` and accumulates them into a per-turn buffer.
   - On `session_init`: UPDATE `metadata.externalSessionId` in the conversation row.
   - On `turn_end`: batch-write the projected messages (one `assistant` row with the concatenated text, one `tool` row per tool_use/tool_result event) in a single transaction with `seq` allocation. UPDATE status to `"completed"`.
   - Passes through every event to the downstream consumer.

Role mapping helper (Task 11 absorbed into this task):
- `text_delta`s accumulate → one `role="assistant"` message with joined text and `metadata.usage` if present.
- `tool_use` → `role="tool"`, `content=JSON.stringify({name,input})`, `metadata={toolUseId, direction:"call"}`.
- `tool_result` → `role="tool"`, `content=toolResult.content`, `metadata={toolUseId, direction:"result", isError}`.
- `canceled` → `role="tool"`, `content=""`, `metadata={type:"canceled"}`.

Tests — 5 cases against `MockAdapter`:
1. Single user turn + scripted `text_delta`s + `turn_end` → persists `user` row then `assistant` row with concatenated text. `status` transitions pending→active→completed.
2. `metadata.externalSessionId` populated from `session_init` event.
3. Second `sendTurn` after first completes uses `--resume` path (verify via adapter assertion that `resumeSessionId` was passed).
4. Calling `sendTurn` while status is `active` → `TurnInProgressError`.
5. Cross-tenant `sendTurn` (conversation belongs to tenant A; call with tenantId=B) → `AgentSessionNotFoundError`.

Commit: `feat(agent): add AgentSession.sendTurn + transcript persistence`

### Task 11: [Merged into Task 10.]

The plan originally split seq-allocation + role mapping into their own task but they're inseparable from `sendTurn`'s implementation. Task 10's commit covers both.

### Task 12: `AgentSession.cancel` + `close`

Add:
```ts
readonly cancel: (input: { conversationId: ChatConversationId; tenantId: TenantId }) => Effect.Effect<void, AgentSessionNotFoundError>;
readonly close: (input: { conversationId: ChatConversationId; tenantId: TenantId }) => Effect.Effect<void, AgentSessionNotFoundError>;
```

`cancel`:
- Verify conversation exists + tenant match.
- If `status = "active"`: the in-flight `sendTurn` fiber needs interrupting. Track active turn fibers in a `Map<ChatConversationId, Fiber>` inside the service closure. Interrupt the fiber; on interruption, the `Effect.acquireRelease` release clause fires SIGTERM → subprocess dies.
- UPDATE status to `"canceled"`. Write a `role="tool", metadata.type="canceled"` marker row via the same seq allocator.

`close`:
- Verify conversation + tenant.
- UPDATE status to `"completed"` (idempotent no-op if already completed/canceled/failed).

Tests — 3 cases:
1. Cancel a turn in progress (use MockAdapter with `perEventDelayMs: 50` to keep it alive) → stream terminates, status=canceled, marker message written.
2. Close a completed conversation → idempotent, no state change.
3. Cancel cross-tenant → `AgentSessionNotFoundError`.

Commit: `feat(agent): add AgentSession.cancel + close (fiber interruption + status transitions)`

### Task 13: Public barrel + `layerAgent` test

`packages/agent/src/index.ts` re-exports:
- `AgentSession`, `layerAgent`, `AgentSessionNotFoundError`, `TurnInProgressError`, `AdapterSpawnError`, `AdapterExitError`
- `AgentEvent`, `AgentAdapter`, `AdapterTurnInput`, `CreateSessionInput`, `AgentSessionShape`
- `claudeCodeAdapter`, `mockAdapter`
- `parseStreamJsonLine`, `StreamJsonBuffer` (for consumers who want direct parser access)
- `__gmackoAgentPhase = "6e" as const`

`packages/agent/package.json` exports:
- `.` → main barrel
- `./adapter` → adapter types + claude-code-adapter + mock-adapter

Layer smoke test `packages/agent/src/__tests__/layer.test.ts` mirrors `@gmacko/secrets`'s pattern — provides `layerAgent(mockAdapter({events:[], exitCode:0}))` with `layerGmackoDb`, verifies all methods resolve.

Tests — 2 cases (layer smoke + package sentinel already from Task 1).

Commit: `feat(agent): finalize @gmacko/agent public barrel`

### Task 14: Exit verification + tag

1. `pnpm -r --filter '!./apps/*' typecheck` green.
2. `pnpm --filter @gmacko/db test && pnpm --filter @gmacko/auth test && pnpm --filter @gmacko/secrets test && pnpm --filter @gmacko/projects test && pnpm --filter @gmacko/agent test` — all green, total ≥ 210.
3. `pnpm -r --filter '!@gmacko/db' --filter '!@gmacko/auth' --filter '!@gmacko/secrets' --filter '!@gmacko/projects' --filter '!@gmacko/agent' --filter '!./apps/*' test` green.
4. Migration idempotency test still passes (no schema changes in 6E).
5. Git tree clean.
6. Tag `phase-6e-complete`.
7. Append "Phase 6E — Completed" to this plan.
8. Merge to master + push tag.

---

## Open items carried into 6F onboarding

- **Other CLI adapters** (`CodexCliAdapter`, `CursorAcpAdapter`, `AgentSdkAdapter` if we commit to it) — each is a follow-up phase implementing `AgentAdapter`. Scope expansion but architecturally parallel.
- **Real-spawn e2e tests** — gated behind `GMACKO_E2E_CLAUDE_CODE=1`. Need to verify happy path + SIGINT against real `claude` binary in a CI or local dev environment.
- **Per-tenant API key routing** — 6E uses env `ANTHROPIC_API_KEY`. When 6J wires `CurrentUser`, tenant-scoped keys via `@gmacko/secrets` become the story.
- **`session_secret_usages.sessionId` FK promotion** — can finally land now that `chat_conversations` is exercised by the agent layer. Carry into 6F or 6J.
- **`chat_conversations.projectId`** — optional FK to `projects.id` for project-scoped conversations. Schema change + service plumbing; defer until a product calls for it.
- **Token usage + cost tracking** — `stream-json` surfaces token counts; persistence could capture them in `chat_messages.metadata.usage`. Task 10 opportunistically records if present; a full cost-tracking pass is its own story.
- **Prompt/transcript capture for analytics** — out of scope; transcripts live in `chat_messages` and can be scraped directly.

## Convention reinforced

- Each task = RED → GREEN → COMMIT with dedicated subagent.
- Adapter interface + MockAdapter up front; real CLI adapter is "just another implementation."
- Transcript is a projection of adapter events, not a ground-truth log.
- `Queue.bounded + Stream.fromQueue` is the canonical Effect 4 push-stream pattern — first real use in gmacko.

---

## Phase 6E — Completed ✅

Tagged `phase-6e-complete`. **32 packages** (no new packages — `@gmacko/agent` was scaffolded at 6A, pivoted in 6E). Workspace typecheck green. **222 tests passing** (up from 189 at end of 6D; forecast was ~221, actual 222). No schema changes in 6E, so migration idempotency test (`migrate.test.ts`) still passes unchanged.

### What landed

- **Pivot commit** `a6b7529` — deleted `dispatch.ts` (Anthropic SDK async generator), dropped `@anthropic-ai/sdk`, scaffolded deps for CLI orchestration.
- **`@gmacko/agent`** rebuilt from scratch as a CLI subprocess orchestrator with 33 tests across 11 files:
  - `AgentAdapter` contract + `AgentEvent` tagged union (`session_init`, `turn_start`, `text_delta`, `tool_use`, `tool_result`, `turn_end`, `canceled`).
  - `parseStreamJsonLine` + `StreamJsonBuffer` — pure NDJSON parser for Claude Code's `--output-format stream-json`, separately testable.
  - `claudeCodeAdapter({binary?})` — spawns `claude --bare -p <prompt> --output-format stream-json --no-session-persistence [--resume …] [--allowedTools …] [--append-system-prompt …]` per turn. Subprocess lifecycle via `Effect.acquireRelease` (SIGTERM on release, escalating to SIGKILL after 500 ms). Stdout bridged to a `Queue.bounded<AgentEvent, AdapterError | Cause.Done>` via `Effect.forkDetach({startImmediately: true})` + `StreamJsonBuffer`. Exit code 0 → `Queue.end`; exit 130 → emit `{type:"canceled"}` then end; other non-zero → `Queue.fail(AdapterExitError)`. `spawnClaudeCode` + `emitAgentEventsFromChild` exported as reusable helpers.
  - `mockAdapter({events, perEventDelayMs?, exitCode?, failSpawn?, stderr?})` — in-memory deterministic adapter for tests. Emitter forked with `Effect.forkScoped` so it tears down cleanly with the caller's scope (Task 12 fixed a subtle leak where `forkDetach` held PGlite transactions open past `afterEach`).
  - `AgentSession` Effect service with 4 methods: `create`, `sendTurn`, `cancel`, `close`. Tenant-scoped via explicit `{tenantId, userId}` (same pattern as `Secrets`/`Projects`). `layerAgent(adapter)` takes the adapter as a constructor arg, NOT as an Effect service — keeps it runtime-swappable per session.
  - Transcript persistence: user prompt → `role:"user"` row; text_deltas → one `role:"assistant"` row with concatenated text; each tool_use/tool_result → `role:"tool"` row with structured metadata; SIGINT/cancel → `role:"tool"` marker with `metadata.type="canceled"`. Sequence allocation via `COALESCE(MAX(seq), 0) + 1` per-turn batch.
  - Per-turn subprocess, multi-turn via `--resume <externalSessionId>` captured from the first turn's `session_init` event into `chat_conversations.metadata.externalSessionId`.
  - In-flight turn cancellation: `Map<conversationId, Deferred<void>>` in the Layer closure; `sendTurn` registers the deferred and wraps its stream in `Stream.interruptWhen(Deferred.await(d))`; `cancel` fires the deferred and writes status + marker row. Uses `Cause.hasInterruptsOnly` inside `Stream.onExit` to distinguish interrupt-only exits from true failures so the post-cancel status doesn't get clobbered to `"failed"`.

### Effect 4 drift findings added to master plan

Nine new rows in the reference table — this phase was the first real use of `Queue + Stream + Effect.acquireRelease + fiber interruption` in gmacko and surfaced a lot:

1. **`Effect.async` renamed to `Effect.callback`** in beta.43. Register callback may return an `Effect<void>` cleanup that runs on interruption.
2. **`Effect.fork` does not exist.** Use `Effect.forkChild` / `Effect.forkDetach` / `Effect.forkScoped`.
3. **`Effect.forkDetach` needs `{startImmediately: true}`** for a producer fiber to run before the current fiber yields.
4. **Prefer `Effect.forkScoped` for caller-scope-bound emitters.** `forkDetach` leaked past PGlite test teardown.
5. **`Queue.shutdown` is WRONG for drain-then-close.** Use `Queue.end` (queue typed `Queue<A, E | Cause.Done>`); `Queue.fail(q, error)` for errored end.
6. **`Stream.ensuringWith` does not exist.** Use `Stream.onExit(finalizer)` where finalizer gets the `Exit<unknown, E>`.
7. **`Stream.catchAll` does not exist.** Use `catchCause` / `catchTag` / etc.
8. **`@effect/vitest` `it.effect` installs TestClock.** Use `it.live` for real-wall-clock observation (subprocess timing, real timers in release clauses).
9. **`Stream.interruptWhen(Deferred.await(d))` + `Cause.hasInterruptsOnly`** is the idiomatic mid-stream cancel pattern.

The master plan's SSE-in-Effect-4 callout has been rewritten accordingly (`Queue.end`, not `Queue.shutdown`).

### Scope deviation from plan

- **Task 11 was absorbed into Task 10.** The plan split seq-allocation + role-mapping out as a separate task; in practice they're inseparable from `sendTurn`'s implementation and one commit. Net task count: 13 (of the planned 14).
- **Test-file layout.** Ended up with one test file per concern (`adapter.test.ts`, `claude-code-adapter.test.ts`, `claude-code-subprocess.test.ts`, `claude-code-stream.test.ts`, `mock-adapter.test.ts`, `stream-json-parser.test.ts`, `agent-session.test.ts`, `agent-send-turn.test.ts`, `agent-cancel.test.ts`, `layer.test.ts`, `package.test.ts`) — 11 files, 33 tests. Readable split but more files than the typical 6C/6D service.
- **Real-spawn e2e tests.** Cover real-subprocess behavior against `node -e "…"` subprocess scripts (via `claudeCodeAdapter({binary: process.execPath})` bypassing `buildArgs`'s `claude`-specific args) inside `it.live`. No gate behind `GMACKO_E2E_CLAUDE_CODE=1` was actually needed — we never invoke the `claude` binary in the test suite, so CI works without it installed.
- **Task 10 ordering tradeoff.** Cancel writes `status="canceled"` + marker row **before** firing the abort Deferred, because `Stream.onExit` would otherwise see the interrupt-only exit and can't reliably distinguish cancel-from-fiber-interruption vs. genuine failure. The final persistence effect re-reads current DB status and preserves `"canceled"` instead of clobbering it. Documented in `agent-session.ts` header comment.

### Known rough edges (non-blocking)

- **PGlite parallel test flakiness** (carried over from 6B/6C/6D) got worse with 6E because `@gmacko/agent` adds another PGlite-heavy suite. Default `pnpm -r test` fails one test per file due to bringup timing under worker parallelism; `--no-file-parallelism` is green. Exit verification here used the serial runner. Fix (out of scope): a workspace-level vitest config that caps concurrency on db-bound suites, or per-package `poolOptions.threads.singleThread`.
- **Streaming bridge uses `Effect.runPromise(Queue.offer(...))` inside a node event handler.** Acknowledged throughput tradeoff — fine for stream-json's event rate, would need revisiting for a high-throughput scenario. Pattern documented inline in `claude-code-adapter.ts`.
- **No real Claude Code invocation tested.** All tests target `node -e` subprocesses with scripted NDJSON. When 6J wires real Claude Code into a real app, exercise the happy path + SIGINT against the actual `claude` binary; surface any real-world divergence from the research reference.

### Open items carried into 6F onboarding

Still deferred as planned:
- **`CodexCliAdapter` + `CursorAcpAdapter` + `AgentSdkAdapter`** — each is a follow-up phase implementing `AgentAdapter`. Architecturally parallel to `claudeCodeAdapter`.
- **`AgentRpc` RPC group** — 6J app wiring.
- **Per-tenant Anthropic API keys** via `@gmacko/secrets` — 6E uses env `ANTHROPIC_API_KEY` only. When 6J exercises `CurrentUser`, tenant-scoped keys become the story.
- **`session_secret_usages.sessionId → chat_conversations.id` FK promotion** — `chat_conversations` is now exercised by the agent layer, so the FK can finally land. Carry to 6F or 6J.
- **`chat_conversations.projectId`** — optional FK to `projects.id` for project-scoped conversations. Schema change + service plumbing.
- **Token usage + cost tracking** — `stream-json` exposes it; `chat_messages.metadata.usage` is the natural home. Opportunistic capture in `sendTurn` is straightforward; a dedicated cost-tracking pass is its own story.
