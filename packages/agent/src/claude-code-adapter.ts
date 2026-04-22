// ClaudeCodeCliAdapter — skeleton shipped in Phase 6E Task 5.
//
// This module exports:
//   - `buildArgs`: pure argv-array builder for a single `claude` invocation.
//     Tested exhaustively; stable ordering guarantees test-snapshot friendly.
//   - `claudeCodeAdapter`: factory returning an `AgentAdapter`. `sendTurn`
//     is stubbed until Tasks 6 (subprocess spawn) and 7 (Queue-based
//     streaming producer) land. The stub fails fast with `AdapterSpawnError`
//     so callers can type-check against the contract and get a loud runtime
//     signal if they accidentally invoke the incomplete adapter.
//
// Canonical CLI invocation (from the protocol research in the Phase 6E plan):
//
//   claude --bare -p <prompt> --output-format stream-json --no-session-persistence
//          [--resume <session-id>]
//          [--allowedTools <csv>]
//          [--append-system-prompt <text>]
//
// All values are passed as separate argv entries — no shell escaping is
// needed because the downstream spawn call (Task 6) will not go through a
// shell.
import { Effect } from "effect";

import type { AdapterTurnInput, AgentAdapter } from "./adapter.js";
import { AdapterSpawnError } from "./adapter.js";

export interface ClaudeCodeAdapterOptions {
  /** Path or name of the `claude` binary. Default: `"claude"`. */
  readonly binary?: string;
}

/**
 * Build the argv array for a single `claude` invocation. Order is not
 * semantically meaningful to the CLI but we keep it stable for
 * test-snapshot friendliness: base flags first, then resume if set, then
 * allowedTools, then system-prompt.
 */
export function buildArgs(input: AdapterTurnInput): string[] {
  const args: string[] = [
    "--bare",
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--no-session-persistence",
  ];
  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }
  if (input.allowedTools && input.allowedTools.length > 0) {
    args.push("--allowedTools", input.allowedTools.join(","));
  }
  if (input.systemPrompt) {
    args.push("--append-system-prompt", input.systemPrompt);
  }
  return args;
}

/**
 * `claudeCodeAdapter` returns an `AgentAdapter` that, when fully wired in
 * Tasks 6-7, spawns `claude` as a subprocess and streams its stream-json
 * output as `AgentEvent`s. Until then, `sendTurn` is stubbed to fail fast
 * so callers can type-check against the contract.
 */
export const claudeCodeAdapter = (
  _opts: ClaudeCodeAdapterOptions = {},
): AgentAdapter => ({
  adapterId: "claude-code",
  sendTurn: () =>
    Effect.fail(
      new AdapterSpawnError({
        adapterId: "claude-code",
        message: "claudeCodeAdapter.sendTurn not yet implemented (Task 6/7)",
      }),
    ),
});
