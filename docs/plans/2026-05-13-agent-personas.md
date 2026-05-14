# Agent Personas

**Date:** 2026-05-13
**Status:** Draft
**Scope:** Bob/blder persona system + gmacko-ops reference repo
**Related:** BizPulse agent registry (separate plan — handles attribution, cost tracking, mandate linking)

## Context

Bob handles agent execution (adapters, sessions, runners, task dispatch). BizPulse handles business attribution (cost tracking, startup linkage, mandate enforcement). Today, agents exist as loose strings (`agentType`, `adapterId`) with no identity, lifecycle, or cost tracking. This plan makes agents first-class entities in Bob via a persona system, and defines the gmacko-ops reference repo that demonstrates the canonical persona YAML format.

**Responsibility split:**
- Bob owns execution identity (persona config, session creation, adapter dispatch, cost calculation)
- BizPulse owns business identity (agent registry, cost attribution, mandate policies)
- Bob pushes session completion data (including cost in microcents) to BizPulse at close time
- gmacko-ops defines reference persona YAML; Bob pulls the repo at startup and syncs to DB

**Key design decisions (from grilling session 2026-05-13):**
- Persona resolution targets the **Bob session router** (`agent.session.*`), not the legacy `AgentSession.create()` / `chatConversations` system
- `adapterId` on the persona maps to `agentType` on the session (naming cleanup deferred); `agentType` reserved for future role concept (planning/coding/testing)
- BizPulse cross-link fields live in `metadata jsonb`, not typed columns — keeps Bob's schema decoupled
- `autonomyLevel` and `budgetLimitCents` are stored and displayed but **enforcement is deferred** — autonomy is injected into the system prompt as a hint; budget accumulator is built but no gate exists yet
- Token/cost tracking is Bob's responsibility; pricing via a hardcoded `model-pricing.ts` config map
- Two persona sources: `source: "repo"` (read-only in Blder, pulled from git) and `source: "ui"` (fully editable in Blder)
- Persona slugs use the ForgeGraph slug as canonical identity

## Part 1: Bob Schema — `agentPersonas` Table

**New file:** `packages/core/src/db/schema/agent-personas.ts`
**Re-export from:** `packages/core/src/db/schema/index.ts`

```sql
agent_personas
  id              uuid PK (defaultRandom)
  tenantId        uuid FK->tenants (cascade)

  name            varchar(256)     -- "Growth Agent", "Backend Lead"
  slug            varchar(128)     -- ForgeGraph slug, unique per tenant, [a-z0-9-], immutable after creation
  description     text             -- human-readable summary for UI display
  adapterId       varchar(128)     -- "claude", "codex", "kiro", etc.
  model           varchar(80)      -- "claude-sonnet-4-6"

  systemPrompt    text             -- persona instructions
  allowedTools    jsonb string[]   -- tool allowlist (enforced via CLI flags where adapter supports it)

  autonomyLevel   varchar(32)      -- observe|recommend|draft|safe_execute|full_execute (enforcement deferred; injected into system prompt as hint)
  budgetLimitCents integer         -- per-session cost cap (enforcement deferred; accumulator built but no gate)

  source          varchar(16)      -- "repo" | "ui" — repo-managed personas are read-only in Blder
  active          boolean default true
  metadata        jsonb default {} -- extensible; BizPulse cross-links stored here as metadata.bizpulse = { agentSlug, mandateId, apiUrl }

  createdAt       timestamp
  updatedAt       timestamp
```

**Indexes:** `(tenantId, slug)` unique, `(tenantId, active)`

**Dropped from original design:**
- `projectId` — all personas are tenant-wide for now; project-scoped overrides are a future feature
- `cwd` — working directory is a session-level concern, determined by repository/worktree at runtime
- `externalMandateId`, `externalAgentSlug`, `bizpulseApiUrl`, `bizpulseApiKey` — moved to `metadata` jsonb

The table follows the existing pattern in `packages/core/src/db/schema/sessions.ts` — pgTable with `uuid().primaryKey().defaultRandom()`, FK references via arrow functions, and jsonb columns with `.$type<>()`.

## Part 2: Extend Session Creation for Persona Resolution

**Target:** Bob session router (`agent.session.create`, `agent.session.bootstrapForChat`), NOT the legacy `AgentSession.create()`

Add optional `personaId` to the session creation RPCs in `packages/core/src/contracts/groups/agent.ts`:

```typescript
// agent.session.create — add personaId to payload
personaId: Schema.optional(Schema.String),

// agent.session.bootstrapForChat — add personaId to payload
personaId: Schema.optional(Schema.String),
```

**Resolution logic** (in the session creation handler):
1. If `personaId` provided, SELECT persona from `agent_personas` where `id = personaId` and `tenantId` matches
2. Use persona's `adapterId`, `systemPrompt`, `allowedTools`, `model` as defaults
3. Direct fields in the creation request override persona defaults (explicit > persona)
4. Store `personaId` and persona metadata (including BizPulse cross-links from `metadata.bizpulse`) in the session's metadata
5. Map `persona.adapterId` → `session.agentType` (the existing session field)

**Override semantics:** All session creators are trusted internal callers (Blder, runner, sync). Overrides can widen or narrow persona defaults. If session creation is ever exposed to external callers, override semantics need revisiting (overrides should only narrow, not widen).

## Part 3: Token/Cost Tracking + BizPulse Push

**Prerequisites — parser and schema changes:**
1. Extend `AgentEventTurnEndSchema` in `packages/core/src/contracts/schemas/agent.ts` to include `inputTokens?: number`, `outputTokens?: number`, `cacheReadTokens?: number`, `cacheCreationTokens?: number`
2. Update `parseStreamJsonLine()` in `packages/core/src/agent/stream-json-parser.ts` to extract usage fields from Claude CLI's stream-json output
3. Write token data to the existing `tokenUsageSessions` table in `packages/bob/src/agents/src/schema.ts` (no new table needed)

**Cost calculation:**
- New file: `packages/core/src/agent/model-pricing.ts` — hardcoded `Record<string, { inputPer1M: number, outputPer1M: number }>` map
- On session close, compute cost from accumulated tokens × model pricing
- Report cost in microcents

**Token accumulator:**
- Add a `Ref` accumulator (same pattern used for turn state in sendTurn) that sums token counts from `turn_end` events across all turns in a session
- On close, read the ref and compute cost from `model-pricing.ts`

**BizPulse push (fire-and-forget):**
When a session closes (status → completed/failed/canceled), if `metadata.bizpulse.agentSlug` and `metadata.bizpulse.apiUrl` are set:

1. Fire a background HTTP POST to `{bizpulseApiUrl}/agent.reportSession`:
   ```json
   {
     "agentSlug": "<from metadata.bizpulse.agentSlug>",
     "externalSessionId": "<sessionId>",
     "startupSlug": "<from metadata, if set>",
     "title": "<session title>",
     "status": "completed|failed|cancelled",
     "inputTokens": 10000,
     "outputTokens": 2345,
     "costMicrocents": 4200,
     "durationMs": 180000,
     "actionsProposed": 5,
     "actionsCompleted": 4,
     "summary": "<agent-generated summary>"
   }
   ```
2. Inline fire-and-forget — no job queue. If it fails, session data remains in Bob's DB and can be reconciled later.

## Part 4: Adapter Extensions

Extend adapter `buildCommand()` to accept and pass through persona configuration:

**Claude adapter** (`packages/core/src/agent/claude-code-adapter.ts`):
- `--model <model>` flag from persona config
- `--allowedTools <tool1,tool2,...>` flag from persona config (hard enforcement — CLI respects this)

**Codex adapter** (`packages/ooda/src/agent-adapters/codex-adapter.ts`):
- Pass model via environment or CLI flag if supported
- `allowedTools` — pass through if adapter supports it, ignore with a note otherwise

**All adapters:**
- `autonomyLevel` is injected into the system prompt text, not as a CLI flag (soft enforcement only)

## Part 5: New RPC Procedures for Persona CRUD

**Modify:** `packages/core/src/contracts/groups/agent.ts`

Add six RPCs to the agent group under `agent.persona.*`:

```typescript
// agent.persona.create
payload: { name, slug, description?, adapterId, model?, systemPrompt?, allowedTools?, autonomyLevel?, budgetLimitCents?, metadata? }
success: AgentPersonaSchema

// agent.persona.list
payload: { active?: boolean }
success: AgentPersonaSchema[]

// agent.persona.get
payload: { id }
success: AgentPersonaSchema
error: NotFoundError

// agent.persona.update (only for source: "ui" personas)
payload: { id, name?, description?, adapterId?, model?, systemPrompt?, allowedTools?, autonomyLevel?, budgetLimitCents?, metadata? }
success: AgentPersonaSchema
error: NotFoundError

// agent.persona.delete (soft-delete: sets active=false; only for source: "ui" personas)
payload: { id }
success: Void
error: NotFoundError

// agent.persona.syncRepo (pulls personas repo, upserts source: "repo" records)
payload: {}
success: { created: number, updated: number, unchanged: number }
```

Notes:
- `update` and `delete` reject operations on `source: "repo"` personas (those are managed via git)
- Slug reuse after soft-delete is not supported in this phase (requires partial unique index `WHERE active = true`)

Add `AgentPersonaSchema` to `packages/core/src/contracts/schemas/` following the existing pattern.

Wire handlers in `packages/bob/src/api/src/rpc-handlers/` following the existing agent handler pattern.

## Part 6: Blder UI Additions

**App:** `apps/blder/`
**Data layer:** Plain fetch + Drizzle (existing pattern — no tRPC/Effect-RPC)

Add new routes:

- `apps/blder/src/app/personas/page.tsx` — list all registered personas
  - Table columns: name, slug, adapter, model, autonomy level, source, active status
  - Filter by active/inactive, source
  - Create button → form (for `source: "ui"` personas only)
  - Repo-managed personas shown with a badge, edit/delete disabled

- `apps/blder/src/app/personas/[id]/page.tsx` — persona detail
  - Profile: name, description, adapter, model, system prompt preview
  - BizPulse linkage (from metadata.bizpulse): agent slug, mandate ID, API URL
  - Recent sessions that used this persona
  - Edit button → inline form (disabled for `source: "repo"` personas)

- `apps/blder/src/app/personas/new/page.tsx` — create persona form
  - All fields from the create RPC
  - System prompt as a resizable textarea
  - Allowed tools as a tag input
  - `source` automatically set to `"ui"`

- `apps/blder/src/app/api/personas/route.ts` — API route for list/create
- `apps/blder/src/app/api/personas/[id]/route.ts` — API route for get/update/delete
- `apps/blder/src/app/api/personas/sync/route.ts` — API route triggering `agent.persona.syncRepo`

## Part 7: gmacko-ops Reference Repo

Reference implementation on git.forgegraf.com: `gmacko-ops`

Other users can fork this repo and point their Bob instance at their own persona repo.

### Repository structure (minimal viable scope)

```
gmacko-ops/
  CLAUDE.md                    -- agent instructions for operating in this repo
  README.md                   -- explains the persona YAML contract

  personas/
    growth-agent.yaml
    compliance-agent.yaml
    devops-agent.yaml
    research-agent.yaml

  templates/
    persona.template.yaml
```

### Persona YAML format (v1)

```yaml
apiVersion: v1
name: Growth Agent
slug: growth-agent
description: Drives user acquisition, activation, and retention across portfolio startups
adapter: claude
model: claude-sonnet-4-6
autonomy_level: safe_execute

system_prompt: |
  You are a growth agent for the Gmacko startup portfolio.
  Your job is to analyze growth metrics, propose campaigns, and execute
  approved growth initiatives. You have access to BizPulse data via API.

  Always check the startup's current objectives before proposing actions.
  Never exceed budget limits. Report all actions back to BizPulse.

allowed_tools:
  - Read
  - Write
  - Bash
  - WebSearch
  - WebFetch

metadata:
  bizpulse:
    agentSlug: growth-agent
    mandateId: mandate-growth-001
    apiUrl: https://bizpulse.gmac.io
```

### Repo pull mechanism

Bob pulls the personas repo on runner startup and on manual trigger (`agent.persona.syncRepo` RPC):

1. Clone/pull the configured personas repo URL (from environment config)
2. Parse all `personas/*.yaml` files, validate against v1 schema
3. Upsert into `agent_personas` with `source: "repo"`, matching by `(tenantId, slug)`
4. Personas in DB with `source: "repo"` whose slug is no longer in the repo are soft-deleted (active=false)

## Implementation Order

### Phase A: Bob persona schema + CRUD (no BizPulse dependency)
1. Create `packages/core/src/db/schema/agent-personas.ts` with pgTable definition
2. Add re-export to `packages/core/src/db/schema/index.ts`
3. Run `drizzle-kit push` to create the table
4. Add `AgentPersonaSchema` to `packages/core/src/contracts/schemas/`
5. Add six persona RPCs to `packages/core/src/contracts/groups/agent.ts`
6. Wire RPC handlers in `packages/bob/src/api/src/rpc-handlers/`
7. Verify: `tsc --noEmit` clean, persona CRUD works via RPC

### Phase B: Persona resolution in session creation
1. Add `personaId` to `agent.session.create` and `agent.session.bootstrapForChat` payloads
2. Add persona lookup + default resolution logic in session creation handler
3. Map `persona.adapterId` → `session.agentType`
4. Extend adapter `buildCommand()` to accept `model` and `allowedTools`
5. Inject `autonomyLevel` into system prompt text
6. Verify: create a session with `personaId`, confirm persona config applied and adapter receives model/tools

### Phase C: Token/cost tracking + BizPulse push
1. Extend `AgentEventTurnEndSchema` with token count fields
2. Update `parseStreamJsonLine()` to extract usage from Claude CLI stream-json output
3. Create `model-pricing.ts` hardcoded pricing map
4. Add token `Ref` accumulator to session turn processing
5. Write accumulated tokens to existing `tokenUsageSessions` table on session close
6. Compute cost from pricing map
7. Add fire-and-forget BizPulse HTTP POST on session close (if metadata.bizpulse configured)
8. Verify: complete a persona-linked session, confirm tokens accumulated, cost computed, BizPulse receives report

### Phase D: Blder UI
1. Add `/personas` list page with filtering
2. Add `/personas/[id]` detail page
3. Add `/personas/new` create form
4. Add API routes with Drizzle queries
5. Add sync trigger button (calls `agent.persona.syncRepo`)
6. Verify: CRUD personas via UI, repo-managed personas are read-only

### Phase E: gmacko-ops reference repo
1. Create `gmacko-ops` repo on git.forgegraf.com
2. Define four persona YAML files (growth, compliance, devops, research)
3. Create `persona.template.yaml`
4. Implement repo pull logic in Bob (startup + syncRepo RPC)
5. Verify: Bob pulls repo on startup, personas appear in Blder with `source: "repo"`, read-only

## Key Files Summary

| What | Path |
|------|------|
| Persona DB schema (new) | `packages/core/src/db/schema/agent-personas.ts` |
| Schema barrel | `packages/core/src/db/schema/index.ts` |
| Model pricing (new) | `packages/core/src/agent/model-pricing.ts` |
| Stream JSON parser | `packages/core/src/agent/stream-json-parser.ts` |
| Claude adapter | `packages/core/src/agent/claude-code-adapter.ts` |
| RPC contracts | `packages/core/src/contracts/groups/agent.ts` |
| RPC schemas (new) | `packages/core/src/contracts/schemas/agent-persona.ts` |
| Session creation handler | `packages/bob/src/api/src/handlers/session.ts` |
| RPC handlers (new) | `packages/bob/src/api/src/rpc-handlers/persona.ts` |
| Token usage table (existing) | `packages/bob/src/agents/src/schema.ts` |
| Blder persona pages (new) | `apps/blder/src/app/personas/` |
| Blder API routes (new) | `apps/blder/src/app/api/personas/` |
| Reference repo (new) | `gmacko-ops/` (git.forgegraf.com) |
