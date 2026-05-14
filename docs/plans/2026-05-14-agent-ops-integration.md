# Agent Operations Integration

**Date:** 2026-05-14
**Status:** Draft
**Scope:** Unified persona-based agent execution, planning migration, Pulse CLI integration, token/cost tracking
**Depends on:** 2026-05-13-agent-personas.md (Phases A+B complete)

## Context

Bob's persona system (schema, CRUD, session resolution, adapter extensions) is built but not yet connected to the three operational use cases:

1. **Completing Linear tasks** — execution daemon picks up sessions, agents do work
2. **Planning sessions → Linear tasks** — agents analyze codebases, produce plan drafts committed to Linear
3. **BizPulse business activities** — agents use Pulse CLI to manage portfolio startups

This plan unifies all three under the persona system and adds token/cost tracking with BizPulse session reporting.

## Design Decisions

- **Pulse CLI as Bash tool.** Agents call `pulse` commands via Bash with `--json` output. No MCP server or custom tooling needed — the CLI was designed for programmatic use.
- **Shared API key.** A node-level `PULSE_API_KEY` env var authenticates all agents. Per-persona keys are a future option.
- **Planning migrates to personas.** The Planner persona replaces hardcoded smol-agent profiles. Shape vs. breakdown intent is a session parameter, not a different agent.
- **One daemon, one code path.** The execution daemon stops skipping planning sessions. All session types flow through persona resolution.
- **Fire-and-forget BizPulse reporting.** Session completion data (tokens, cost, summary) is POSTed to BizPulse on close. No queue, no retry — Bob's DB is the source of truth.

## Part 1: Five Personas

Created as YAML files in the gmacko-ops repo, synced to Bob via `agent.persona.syncRepo`.

### Planner (`planner.yaml`)

- **Adapter:** claude
- **Model:** claude-sonnet-4-6
- **Autonomy:** draft
- **Allowed tools:** Read, Glob, Grep, Bash, WebSearch
- **System prompt:** Analyze codebases, propose work breakdowns, create plan drafts. Handles both shape (high-level analysis) and breakdown (detailed executable tasks) intents based on session context.
- **Replaces:** `buildSmolAgentShapeProfile()` and `buildSmolAgentPlanningProfile()` in `apps/bob-execution/src/planning/startPlanningSession.ts`

### Growth Agent (`growth-agent.yaml`)

- **Adapter:** claude
- **Model:** claude-sonnet-4-6
- **Autonomy:** safe_execute
- **Allowed tools:** Read, Bash, WebSearch, WebFetch
- **System prompt:** Use Pulse CLI for growth operations — reviews, bottlenecks, campaigns, action execution. Only execute `read` or `safe_write` risk actions autonomously.
- **BizPulse metadata:** `{ agentSlug: "growth-agent", apiUrl: "https://bizpulse.cc" }`

### Compliance Agent (`compliance-agent.yaml`)

- **Adapter:** claude
- **Model:** claude-sonnet-4-6
- **Autonomy:** recommend
- **Allowed tools:** Read, Bash, WebSearch
- **System prompt:** Use Pulse CLI for entity compliance checks, integration audits, setup verification. Proposes actions but does not execute.
- **BizPulse metadata:** `{ agentSlug: "compliance-agent", apiUrl: "https://bizpulse.cc" }`

### DevOps Agent (`devops-agent.yaml`)

- **Adapter:** claude
- **Model:** claude-sonnet-4-6
- **Autonomy:** safe_execute
- **Allowed tools:** Read, Write, Edit, Bash, Grep, Glob
- **System prompt:** Use Pulse CLI for deployments, syncs, alert triage. Can make code changes (bug fixes, config updates) and deploy via `pulse deploy`.
- **BizPulse metadata:** `{ agentSlug: "devops-agent", apiUrl: "https://bizpulse.cc" }`

### Research Agent (`research-agent.yaml`)

- **Adapter:** claude
- **Model:** claude-sonnet-4-6
- **Autonomy:** observe
- **Allowed tools:** Read, Bash, WebSearch, WebFetch
- **System prompt:** Use Pulse CLI for portfolio status, startup analysis, market research. Read-only — reports findings, never executes actions.
- **BizPulse metadata:** `{ agentSlug: "research-agent", apiUrl: "https://bizpulse.cc" }`

## Part 2: Planning Session Migration

### Current flow (to be replaced)

`startPlanningSession()` builds smol-agent profiles inline with hardcoded system prompts, then nudges the daemon. The daemon skips planning sessions (`sessionType === "planning"` → early return), so planning runs through a separate code path.

### New flow

1. **`planSessionStart()` resolves the Planner persona by slug.** Looks up `slug: "planner"` in `agent_personas`, gets persona ID.
2. **Creates the session with `personaId`.** Calls `resolvePersonaDefaults()` to populate session with persona config.
3. **Nudges the daemon with persona config.** The nudge payload includes `personaConfig` (model, system prompt, tools) from the resolved persona.
4. **The daemon handles it like any other session.** No special planning code path — the Planner persona's system prompt defines behavior.
5. **Planning context flows via the prompt.** `buildPrompt()` is extended: when `sessionType === "planning"`, it includes intent (shape/breakdown), project name, launch context, and attached files.
6. **Plan draft creation is prompt-driven.** The Planner persona's system prompt instructs the agent to output structured plan drafts. Bob's existing `planSessionCommitPlan` handler commits them to Linear.

### Migration steps

- Add persona slug lookup helper (find persona by `(tenantId, slug)`)
- Update `startPlanningSession()` to resolve Planner persona instead of building smol-agent profiles
- Remove the `if (session.sessionType === "planning") return` guard from the daemon
- Extend `buildPrompt()` with planning context injection
- Keep `planSessionCommitPlan()` unchanged — it reads plan drafts from DB regardless of how they were created

## Part 3: Pulse CLI Integration

### Environment

The execution daemon injects Pulse CLI credentials into every agent subprocess:

```typescript
env: {
  ...process.env,
  CI: "true",
  TERM: "dumb",
  PULSE_API_KEY: process.env.PULSE_API_KEY,
  PULSE_API_URL: process.env.PULSE_API_URL ?? "https://bizpulse.cc",
}
```

Harmless for non-BizPulse sessions, essential for BizPulse ones. No `pulse login` needed — the CLI reads `PULSE_API_KEY` from the environment.

### System prompt pattern

Each BizPulse persona's system prompt teaches the agent its available Pulse commands with `--json` flags. Example for Growth Agent:

```
You have access to the Pulse CLI for portfolio operations.
Always use --json for machine-readable output.

Key commands:
- pulse growth review --startup <slug> --json
- pulse growth bottlenecks --startup <slug> --json
- pulse campaigns list --startup <slug> --json
- pulse actions list --startup <slug> --json
- pulse actions execute-next --startup <slug> --target <system> --json

Before executing any action, check its risk level.
Only execute actions with risk "read" or "safe_write" autonomously.
For "external_write" or "dangerous_write", report findings and stop.
```

### Startup context

When a BizPulse session is created, `metadata.bizpulse.startupSlug` identifies which startup the agent operates on. The prompt builder injects: "You are operating on startup: `<slug>`".

## Part 4: Token/Cost Tracking + BizPulse Reporting

### Model pricing config

Extract the daemon's inline pricing into `packages/core/src/agent/model-pricing.ts`:

```typescript
export const MODEL_PRICING: Record<string, {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheCreationPer1M: number;
}> = {
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3, cacheCreationPer1M: 3.75 },
  "claude-opus-4-6":   { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5, cacheCreationPer1M: 18.75 },
  "claude-haiku-4-5":  { inputPer1M: 0.8, outputPer1M: 4.0, cacheReadPer1M: 0.08, cacheCreationPer1M: 1.0 },
};

export function computeCostMicrocents(model: string, tokens: TokenCounts): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"];
  const inputCost = (tokens.input / 1_000_000) * pricing.inputPer1M;
  const outputCost = (tokens.output / 1_000_000) * pricing.outputPer1M;
  const cacheCost = (tokens.cacheRead / 1_000_000) * pricing.cacheReadPer1M
    + (tokens.cacheCreation / 1_000_000) * pricing.cacheCreationPer1M;
  return Math.round((inputCost + outputCost + cacheCost) * 100_000_000);
}
```

### Token persistence

The daemon's `parseTokenUsage()` already extracts tokens from agent output. On session close, write to `tokenUsageSessions` and include `personaId` for per-persona attribution.

### BizPulse session report

On session close, if `metadata.bizpulse.apiUrl` is set:

```typescript
async function reportToBizPulse(session: CompletedSession, tokens: TokenCounts): Promise<void> {
  const { apiUrl, agentSlug, startupSlug } = session.personaMetadata?.bizpulse ?? {};
  if (!apiUrl || !agentSlug) return;

  const costMicrocents = computeCostMicrocents(session.model, tokens);

  try {
    await fetch(`${apiUrl}/api/trpc/agent.reportSession`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.PULSE_API_KEY}`,
      },
      body: JSON.stringify({
        agentSlug,
        externalSessionId: session.id,
        startupSlug: startupSlug ?? null,
        title: session.title,
        status: session.status,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        costMicrocents,
        durationMs: session.durationMs,
        summary: session.finalOutput?.slice(0, 2000) ?? null,
      }),
    });
  } catch {
    // Fire-and-forget — Bob's DB is the source of truth
  }
}
```

## Part 5: Execution Daemon Unification

### Remove planning skip

Delete the `if (session.sessionType === "planning") return` guard in `handleSessionAvailable()`.

### Accept persona config from gateway

Extend `ServerSessionAvailable`:

```typescript
interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  description?: string;
  identifier?: string;
  branch?: string;
  // New persona fields
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
}
```

### Context-aware prompt building

`buildPrompt()` extended:
- **Execution sessions:** Linear task info (identifier, title, description, branch) — unchanged
- **Planning sessions:** Planning context (intent, project name, launch context, attached files)
- **BizPulse sessions:** Startup slug from `metadata.bizpulse.startupSlug`

### Persona-first agent command

`getAgentCommand()` uses persona config directly when available. The `agentType` switch becomes the fallback for sessions without a persona.

### Environment injection

`PULSE_API_KEY` and `PULSE_API_URL` always injected into subprocess env.

## Implementation Order

### Phase 1: Model pricing + daemon environment (foundation)
1. Create `packages/core/src/agent/model-pricing.ts`
2. Add `PULSE_API_KEY` / `PULSE_API_URL` injection to daemon subprocess env
3. Verify: daemon starts clean, env vars available to agent subprocesses

### Phase 2: Daemon unification (remove planning skip, accept persona config)
1. Extend `ServerSessionAvailable` with persona fields
2. Remove planning session skip guard
3. Update `getAgentCommand()` to use persona config when available
4. Extend `buildPrompt()` with planning context and BizPulse startup slug
5. Verify: daemon handles both execution and planning sessions

### Phase 3: Planning migration (smol-agent → persona)
1. Add persona slug lookup helper
2. Update `startPlanningSession()` to resolve Planner persona
3. Update nudge payload to include persona config
4. Verify: planning session creates with persona, daemon picks it up

### Phase 4: Token tracking + BizPulse reporting
1. Persist token data to `tokenUsageSessions` on session close
2. Use `model-pricing.ts` for cost calculation (replace inline pricing)
3. Add `reportToBizPulse()` fire-and-forget POST on session close
4. Verify: session close writes tokens, BizPulse receives report

### Phase 5: Persona YAML definitions (gmacko-ops)
1. Create five persona YAML files (planner, growth, compliance, devops, research)
2. Implement repo pull logic in Bob (`agent.persona.syncRepo` backend)
3. Verify: personas sync from repo, appear in DB with `source: "repo"`

## Key Files

| What | Path | Change |
|------|------|--------|
| Model pricing | `packages/core/src/agent/model-pricing.ts` | New |
| Execution daemon | `apps/bob-execution/src/daemon/index.ts` | Modified (unified, persona-aware) |
| Planning session start | `apps/bob-execution/src/planning/startPlanningSession.ts` | Modified (persona resolution) |
| Plan session handler | `packages/bob/src/api/src/handlers/planSession.ts` | Modified (persona ID in nudge) |
| Persona handlers | `packages/bob/src/api/src/handlers/persona.ts` | Modified (slug lookup helper) |
| Agent persona schema | `packages/core/src/db/schema/agent-personas.ts` | Unchanged |
| Session creation | `packages/bob/src/api/src/handlers/session.ts` | Unchanged |
| Token usage table | `packages/bob/src/agents/src/schema.ts` | Unchanged |
| Persona YAML files | `gmacko-ops/personas/*.yaml` | New (external repo) |
