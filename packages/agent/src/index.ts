// @gmacko/agent — CLI subprocess orchestrator for agent sessions.
//
// 6E pivots away from direct Anthropic SDK calls to spawning agent CLIs
// (claude-code, codex, cursor-acp) as subprocesses. Real exports land in
// Tasks 3-13 of the 6E plan. This file currently carries only a version
// sentinel so the Task 1 smoke test can prove the package resolves.
export const __gmackoAgentPhase = "6e" as const;
