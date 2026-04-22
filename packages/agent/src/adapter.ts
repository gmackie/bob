// Adapter contract + streamed-event tagged union for `@gmacko/agent`.
//
// Every agent CLI backend (Claude Code, Codex, Cursor-ACP, MockAdapter) is
// expressed as an `AgentAdapter` value. `AgentSession` (Task 9) holds a
// single adapter in its layer closure and projects its event stream into
// the `chat_messages` transcript.
//
// This file is pure types + error classes — no runtime logic, no side
// effects. Concrete adapter implementations land in Tasks 5 (ClaudeCode)
// and 8 (Mock).
import { Effect, Schema, Stream, type Scope } from "effect";

// --- AgentEvent tagged union -----------------------------------------------
// Emitted by any AgentAdapter's sendTurn stream. Concrete adapter
// implementations project their transport output into these events; the
// transcript layer in `AgentSession.sendTurn` consumes them without needing
// to know which adapter produced them.

export type AgentEvent =
  | {
      readonly type: "session_init";
      readonly externalSessionId: string;
      readonly model: string;
    }
  | { readonly type: "turn_start" }
  | { readonly type: "text_delta"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string;
      readonly isError: boolean;
    }
  | { readonly type: "turn_end"; readonly stopReason: string }
  | { readonly type: "canceled" };

// --- Adapter turn input ----------------------------------------------------

export interface AdapterTurnInput {
  readonly prompt: string;
  /**
   * For adapters that support multi-turn continuity, the external session id
   * returned by a prior `session_init` event. The adapter uses this to
   * "resume" — e.g. Claude Code's `--resume <id>` flag.
   */
  readonly resumeSessionId?: string;
  readonly systemPrompt?: string;
  readonly allowedTools?: readonly string[];
  /** Working directory for the subprocess, if applicable to the adapter. */
  readonly cwd?: string;
}

// --- Adapter contract ------------------------------------------------------
// Each adapter is an in-process value (not an Effect service) because a
// single `AgentSession` may use different adapters per session at runtime.
// The adapter is injected into `layerAgent(adapter)` at app bootstrap.

export interface AgentAdapter {
  /** Stable adapter identifier. Examples: "claude-code", "codex", "cursor-acp", "mock". */
  readonly adapterId: string;
  /**
   * Emit events for a single turn. Effect requirement includes `Scope` so
   * the caller's scope governs subprocess lifetime (if any). The returned
   * stream completes when the turn ends; adapter errors surface on the
   * stream's error channel via `Stream.fromQueue`'s `Exclude<E, Cause.Done>`
   * semantics.
   */
  readonly sendTurn: (
    input: AdapterTurnInput,
  ) => Effect.Effect<
    Stream.Stream<AgentEvent, AdapterError>,
    AdapterError,
    Scope.Scope
  >;
}

// --- Tagged errors ---------------------------------------------------------

export class AdapterSpawnError extends Schema.TaggedErrorClass<AdapterSpawnError>()(
  "AdapterSpawnError",
  { adapterId: Schema.String, message: Schema.String },
) {}

export class AdapterExitError extends Schema.TaggedErrorClass<AdapterExitError>()(
  "AdapterExitError",
  { adapterId: Schema.String, code: Schema.Number, stderr: Schema.String },
) {}

export type AdapterError = AdapterSpawnError | AdapterExitError;
