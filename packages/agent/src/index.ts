// @gmacko/agent — CLI subprocess orchestrator for agent sessions.
//
// Public surface:
//   - `AgentSession` / `layerAgent(adapter)` — Effect service + Layer factory
//     for creating and driving agent sessions backed by chat_conversations
//     in @gmacko/db.
//   - `AgentAdapter` + `AgentEvent` — contract every CLI adapter implements,
//     plus the tagged-union event shape they emit.
//   - `claudeCodeAdapter({binary?})` — the Claude Code CLI adapter.
//     Multi-turn via `--resume`. Spawns `claude` per turn.
//   - `mockAdapter({events, ...})` — deterministic in-memory adapter
//     for tests.
//   - Tagged errors: `AgentSessionNotFoundError`, `TurnInProgressError`,
//     `AdapterSpawnError`, `AdapterExitError`.
//   - `parseStreamJsonLine` / `StreamJsonBuffer` — the NDJSON parser
//     primitives, exposed for consumers that want to parse Claude Code
//     stream-json out-of-band (e.g. log ingestion).
//
// Other CLI adapters (CodexCliAdapter, CursorAcpAdapter) land in follow-up
// phases implementing the same AgentAdapter contract.

export {
  AgentSession,
  layerAgent,
  AgentSessionNotFoundError,
  TurnInProgressError,
} from "./agent-session.js";
export type {
  CreateSessionInput,
  CreatedSession,
  SendTurnInput,
  AgentSessionShape,
} from "./agent-session.js";

export {
  AdapterSpawnError,
  AdapterExitError,
} from "./adapter.js";
export type {
  AgentAdapter,
  AgentEvent,
  AdapterTurnInput,
  AdapterError,
} from "./adapter.js";

export { claudeCodeAdapter, buildArgs, spawnClaudeCode, emitAgentEventsFromChild } from "./claude-code-adapter.js";
export type { ClaudeCodeAdapterOptions, SpawnedChild } from "./claude-code-adapter.js";

export { mockAdapter } from "./mock-adapter.js";
export type { MockAdapterScript } from "./mock-adapter.js";

export { parseStreamJsonLine, StreamJsonBuffer } from "./stream-json-parser.js";

/** Package version/phase sentinel — kept for the Task 1 smoke test. */
export const __gmackoAgentPhase = "6e" as const;
