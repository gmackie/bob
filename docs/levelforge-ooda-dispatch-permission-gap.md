# OODA DB-dispatch path hangs on tool permissions (no persona → no autonomy mode)

_From the LevelForge side, 2026-07-27. The apiKey-auth ask from the earlier note is
DONE (merged PR #39 + edge Hyperdrive fix `0d1822fd` — verified working against
`ooda.blder.bot`). This note is a separate, still-open finding._

## Summary

A session created via **`runner.sendPrompt`** (the programmatic DB-dispatch path,
as opposed to the bob-gateway WebSocket path) **hangs forever the first time the
agent calls a tool that isn't on the allowlist** — e.g. any user/project-scope MCP
tool. There is no persona and nothing answers the permission prompt, so the run
never completes.

## Evidence / repro

1. `POST /api/trpc/runner.sendPrompt` `{threadId, runnerId, adapterId:"claude",
   toolProfileId:"default", prompt}` → runner claims it, `[runner] executing session …`.
2. The claude adapter is launched in default `permissionMode: "prompt"`
   (`--permission-prompt-tool stdio`). The agent calls a user-scope MCP tool
   (`mcp__unity__gameobject-create`).
3. That tool is outside the allowlist, so it surfaces on the stream-json control
   channel as `control_request` / `can_use_tool` and **pauses waiting for a
   `control_response`**. The session stream shows the `can_use_tool` request with
   `permission_suggestions`, and **no `control_response` ever follows**. claude
   blocks indefinitely; the session sits `running`.

## Root cause (in this repo)

- `apps/ooda-runner/src/session/session-executor.ts` `execute()` calls
  `adapter.buildCommand({ prompt, workspaceRoot, systemPrompt })` — it does **not**
  pass `permissionMode`, and it does **not** wire a `respondPermission` responder.
- `packages/ooda/src/agent-adapters/claude-adapter.ts:85` therefore defaults to
  `"prompt"`, emitting `permission_request` events (line ~304) that, on the DB
  path, nobody consumes.
- Contrast the gateway path: `apps/ooda-runner/src/bob-gateway.ts:1173`
  `permissionModeFor()` returns `"skip"` for `personaConfig.autonomyLevel === "full"`,
  and `bob-gateway` wires `respondPermission`. `runner.sendPrompt` sessions have no
  persona, so neither applies.

## What LevelForge did as a stop-gap (host-side, no source change)

`claude-adapter.ts:88` honors `process.env.CLAUDE_PERMISSION_PROMPT_ARGS` in prompt
mode. On the dedicated LevelForge Unity runner we set, in the runner's
`EnvironmentFile`:

```
CLAUDE_PERMISSION_PROMPT_ARGS=--dangerously-skip-permissions
```

That routes prompt-mode runs to full autonomy. After that, the same dispatch
completed cleanly: `gameobject-create` → Unity `instanceID:-1456` → `scene-get-data`
confirmed → `result subtype=success`. Good enough for a single-purpose autonomous
host, but it's a blunt instrument (every DB session becomes full-autonomy).

## Suggested proper fix (your call)

Give the DB-dispatch path a first-class permission/autonomy story, e.g.:
- Add an optional `permissionMode` (or `autonomyLevel`) to the `runner.sendPrompt`
  input and thread it through `executeSession` → `session-executor` → `buildCommand`; or
- Have `session-executor` wire a `respondPermission` auto-approver (allowlist-driven)
  for headless DB sessions; or
- Let a session opt into a tool allowlist (e.g. `mcp__unity`) so the specific MCP
  server is pre-authorized rather than bypassing permissions wholesale.

Runner device: `9de9ca8a-7ce5-4944-a56a-80f0e5eefae7` (vanuc). Workspace
`levelforge-unity` (`9523c800-d2f5-4336-a6d3-ac2305f2b0a5`). Owner user `tkE66…`.
