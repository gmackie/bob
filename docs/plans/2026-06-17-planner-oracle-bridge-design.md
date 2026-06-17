# Planner ↔ Oracle Bridge — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming complete)
**Goal:** Bob's server-side planner generates plans grounded in OODA's knowledge base.

## Context

Today the Bob↔OODA bridge is asymmetric:

- **OODA → Bob (output):** the runner reports run status/output to Bob's public API
  (`b66e5ea3`, `0fe2556f`).
- **Mobile → OODA (input):** `mobile-bob` queries the oracle directly via tRPC slash
  commands (`/search`, `32085e66`).
- **Planner → OODA (input): MISSING.** Bob's server-side planning daemon
  (`apps/bob-execution`) builds its prompt purely from static `launchContext`. The
  planner persona's tools are `[Read, Glob, Grep, Bash, WebSearch]` — no knowledge
  access. Plans are generated with zero domain knowledge from OODA.

This design closes that gap.

### Relevant existing code

- Daemon spawn: `apps/bob-execution/src/daemon/index.ts` — `getAgentCommand()` builds the
  `claude` CLI args (`--append-system-prompt`, `--allowedTools`, `--model`);
  `buildAgentPrompt()` / `runAgent()` assemble the prompt and spawn.
- Oracle procedure: `packages/ooda/src/api/router/oracle.ts` — `oracle.query` (auth: Bearer
  `OODA_ORACLE_TOKEN`) → `OracleQueryResult { chunks, confidence, queryId, latencyMs }`.
- tRPC-to-OODA client pattern to mirror: `apps/ooda-runner/src/trpc-client.ts`.
- Fire-and-forget resilience pattern to mirror: `apps/ooda-runner/src/bob-run-reporter.ts`.
- Planner persona: `docs/personas/planner.yaml`.

## Architecture (hybrid: two channels)

```
planSessionStart → gateway nudge → daemon
  ├─ buildAgentPrompt: oracle.query(intent) → inject chunks   [Channel A]
  └─ getAgentCommand(claude): + --mcp-config ooda-oracle       [Channel B]
        └─ claude spawns → planner calls mcp__ooda__oracle_query on demand
```

Both channels hit the same `oracle.query` procedure with `OODA_ORACLE_TOKEN`. The whole
feature is gated behind `OODA_API_URL` + `OODA_ORACLE_TOKEN` being set on the daemon —
absent those, planning behaves exactly as today (zero regression).

**Principle:** the oracle *enriches* planning but is *never on the critical path*. A
planning session must always complete even if OODA is down.

## Channel A — Seed injection (deterministic)

**New module:** `apps/bob-execution/src/oracle-client.ts` — mirrors
`apps/ooda-runner/src/trpc-client.ts` but typed to just the oracle procedure (keeps the
daemon self-contained; avoids importing the whole OODA `AppRouter` type). Thin
`createOracleClient(url, token)` → `{ query(input): Promise<OracleQueryResult> }` over
`httpBatchLink` + SuperJSON with `Authorization: Bearer ${OODA_ORACLE_TOKEN}`.

**Where it fires:** in `runAgent` (or a helper from `buildAgentPrompt`), gated on
`sessionType === "planning"` **and** `oracleEnabled`. Query:

```ts
oracle.query({
  task: "bob planning",
  repo: session.repo,                      // when present
  question: `${intent}\n\n${notes}`.trim(),
  topK: 6,
})
```

**Injection:** if chunks return, append to the prompt:

```
## Knowledge from OODA (oracle, confidence 0.NN)
1. [<source title>] <chunk content>
2. ...
_Use the oracle_query tool to dig deeper into any of these._
```

The last line bridges A→B (tells the planner the live tool exists).

**Resilience (mirrors `bob-run-reporter`):** 3s timeout via `AbortController`; try/catch →
on error or empty results inject nothing, log `[oracle] seed query skipped: <reason>`,
continue. Never blocks or fails plan generation.

**Logging:** on success `[oracle] seed: <N> chunks, confidence <X>, queryId <id>, <ms>ms`.
`queryId` is logged but feedback is **not** auto-submitted (deferred hook).

## Channel B — Live `oracle_query` tool (agentic)

**New file:** `apps/bob-execution/src/ooda-oracle-mcp.ts` — standalone stdio MCP server
(`@modelcontextprotocol/sdk`), run via `tsx` to match the box's no-build deploy. Reuses
the same `createOracleClient`. One tool:

```
oracle_query:
  input:  { question: string, topK?: number (default 6), repo?: string }
  output: text content — ranked chunks (source title + content + confidence)
```

On oracle error it returns an `isError` tool result (not a throw) — the planner reads the
message and continues.

**Daemon wiring (`getAgentCommand`, claude case):** when the persona opts in, the daemon:

1. Writes an MCP config JSON once at startup to a temp path:
   ```json
   { "mcpServers": { "ooda": {
       "command": "tsx",
       "args": ["<abs>/ooda-oracle-mcp.ts"],
       "env": { "OODA_API_URL": "...", "OODA_ORACLE_TOKEN": "..." } } } }
   ```
2. Appends `--mcp-config <path>` to the claude args.
3. Ensures `mcp__ooda__oracle_query` is in `--allowedTools` (merged with persona tools).

**Opt-in mechanism:** a persona flag, not a hardcoded session type. Add `oracleAccess: true`
to `planner.yaml`; the daemon reads it from `PersonaConfig` and only attaches the MCP
server + tool when set. Keeps the bridge reusable for future personas and off general
agent runs.

**Persona changes (`docs/personas/planner.yaml`):**
- `allowed_tools`: add `mcp__ooda__oracle_query`
- system prompt: "Before breaking work into tasks, query the OODA oracle (`oracle_query`)
  for documented patterns, prior decisions, and domain knowledge relevant to the intent.
  Cite what you used."

## Config & auth

**New daemon env vars** (both required; absent → feature off, no regression):
- `OODA_API_URL` — base URL of OODA's tRPC API reachable from hetzner-bob (likely the same
  value the runner already uses).
- `OODA_ORACLE_TOKEN` — bearer the `oracle.query` procedure validates (distinct from
  `OODA_RUNNER_SECRET`).

**Single gate:** `const oracleEnabled = Boolean(OODA_API_URL && OODA_ORACLE_TOKEN)` (mirrors
`bob-run-reporter`'s `enabled`). Drives both channels. The MCP server self-checks the same
vars and exits cleanly if missing.

**PATH caveat:** `tsx` must be on `claude`'s spawn `PATH` so the MCP server launches —
verify on the box during implementation.

## Failure modes (all non-blocking)

| Failure | Behavior |
|---|---|
| Oracle unreachable / 401 / timeout (seed) | Log + inject nothing; plan proceeds |
| Oracle returns 0 chunks (seed) | No section injected; plan proceeds |
| MCP server fails to launch | claude logs unavailable tool; planner proceeds without it |
| `oracle_query` errors mid-session | Tool returns `isError`; planner reads message, continues |
| Env unset | Whole feature off; identical to today |

## Testing

**Unit (Vitest, `apps/bob-execution`):**
- `oracle-client`: builds correct input from `intent`/`notes`/`repo`/`topK`; sets bearer;
  surfaces errors as rejections.
- Prompt injection: chunks → emits `## Knowledge from OODA` section with titles +
  confidence; empty/throw → emits nothing; `oracleEnabled=false` → never calls client.
- `getAgentCommand`: `oracleAccess` persona → args include `--mcp-config` and
  `mcp__ooda__oracle_query`; without → unchanged (regression guard).

**MCP server:** tool schema validates; handler maps `OracleQueryResult` → text content;
oracle error → `isError` result (not a throw).

**Manual integration (hetzner-bob — the real proof):**
1. Start a planning session; confirm `[oracle] seed: N chunks, confidence X, queryId …`.
2. Confirm the generated prompt contains the knowledge section.
3. Confirm the claude transcript lists `mcp__ooda__oracle_query` and the planner invokes it.
4. Kill OODA / unset token → planning still completes cleanly (no section, no tool, no error).

## Rollout

1. Land code + persona change behind the env gate (off by default — safe to merge to `master`).
2. Set `OODA_API_URL` + `OODA_ORACLE_TOKEN` in the daemon's `EnvironmentFile` on hetzner-bob.
3. Deploy (push → fetch/checkout as `bob` → `systemctl restart ooda-runner.service`),
   verify the four manual checks.
4. Deferred follow-up: wire `oracle.logFeedback` once we can judge "was the knowledge
   used" (queryId is already logged).
