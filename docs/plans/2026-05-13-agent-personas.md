# Agent Personas

**Date:** 2026-05-13
**Status:** Draft
**Scope:** Bob/blder persona system + gmacko-ops management repo
**Related:** BizPulse agent registry (separate plan — handles attribution, cost tracking, mandate linking)

## Context

Bob handles agent execution (adapters, sessions, runners, task dispatch). BizPulse handles business attribution (cost tracking, startup linkage, mandate enforcement). Today, agents exist as loose strings (`agentType`, `adapterId`) with no identity, lifecycle, or cost tracking. This plan makes agents first-class entities in Bob via a persona system, and defines the gmacko-ops management repo that serves as the canonical source of truth for persona definitions.

**Responsibility split:**
- Bob owns execution identity (persona config, session creation, adapter dispatch)
- BizPulse owns business identity (agent registry, cost attribution, mandate policies)
- Bob pushes session completion data to BizPulse at close time
- gmacko-ops defines canonical persona YAML; a sync script writes to both systems

## Part 1: Bob Schema -- `agentPersonas` Table

**New file:** `packages/core/src/db/schema/agent-personas.ts`
**Re-export from:** `packages/core/src/db/schema/index.ts`

```sql
agent_personas
  id              uuid PK (defaultRandom)
  tenantId        uuid FK->tenants (cascade)
  projectId       uuid FK->projects (nullable, cascade)  -- null = tenant-wide

  name            varchar(256)     -- "Growth Agent", "Backend Lead"
  slug            varchar(128)     -- unique per tenant
  adapterId       varchar(128)     -- "claude-code", "codex", etc.
  model           varchar(80)      -- "claude-sonnet-4-6"

  systemPrompt    text             -- persona instructions
  allowedTools    jsonb string[]   -- tool allowlist
  cwd             text             -- default working directory

  autonomyLevel   varchar(32)      -- observe|recommend|draft|safe_execute|full_execute
  budgetLimitCents integer         -- per-session cost cap

  -- BizPulse cross-links
  externalMandateId varchar(200)   -- BizPulse agentMandate.id (policy sync)
  externalAgentSlug varchar(100)   -- BizPulse agent.slug (session reporting)
  bizpulseApiUrl    text           -- BizPulse API endpoint for push
  bizpulseApiKey    text           -- API key (encrypted via Bob's secrets system)

  active          boolean default true
  metadata        jsonb default {}

  createdAt       timestamp
  updatedAt       timestamp
```

**Indexes:** `(tenantId, slug)` unique, `(projectId)`, `(tenantId, active)`

The table follows the existing pattern in `packages/core/src/db/schema/sessions.ts` -- pgTable with `uuid().primaryKey().defaultRandom()`, FK references via arrow functions, and jsonb columns with `.$type<>()`.

## Part 2: Extend CreateSessionInput for Persona Resolution

**Modify:** `packages/core/src/agent/agent-session.ts`

Add optional `personaId` to the existing `CreateSessionInput` interface:

```typescript
export interface CreateSessionInput {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly adapterId: string;
  readonly title?: string;
  readonly personaId?: string;       // NEW -- resolve config from persona
  readonly systemPrompt?: string;    // overrides persona default
  readonly allowedTools?: readonly string[];
  readonly cwd?: string;
}
```

In `AgentSession.create()`:
1. If `personaId` provided, SELECT persona from `agent_personas` where `id = personaId` and `tenantId` matches
2. Use persona's `adapterId`, `systemPrompt`, `allowedTools`, `cwd`, `model` as defaults
3. Direct fields in `CreateSessionInput` override persona defaults (explicit > persona)
4. Store `personaId`, `externalAgentSlug`, `bizpulseApiUrl` in `chatConversations.metadata`

Also extend `AgentCreateSessionRpc` in `packages/core/src/contracts/groups/agent.ts`:

```typescript
export const AgentCreateSessionRpc = Rpc.make("agent.createSession", {
  payload: Schema.Struct({
    adapterId: Schema.String,
    title: Schema.optional(Schema.String),
    systemPrompt: Schema.optional(Schema.String),
    allowedTools: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
    personaId: Schema.optional(Schema.String),  // NEW
  }),
  // ...
});
```

And add `personaId` to `AgentSessionCreateRpc` and `AgentSessionBootstrapForChatRpc` in the same file.

## Part 3: Session Completion -> BizPulse Push

**Modify:** `packages/core/src/agent/agent-session.ts` (sendTurn finalizer / close method)

When a conversation closes (status -> completed/failed/canceled), if `metadata.externalAgentSlug` and `metadata.bizpulseApiUrl` are set:

1. Accumulate token counts from adapter events during the session (already available via `session_init` and `turn_end` events)
2. Fire a background HTTP POST to `{bizpulseApiUrl}/agent.reportSession`:
   ```json
   {
     "agentSlug": "<externalAgentSlug>",
     "externalSessionId": "<conversationId>",
     "startupSlug": "<from metadata, if set>",
     "title": "<conversation title>",
     "status": "completed|failed|cancelled",
     "tokensUsed": 12345,
     "costCents": 42,
     "durationMs": 180000,
     "actionsProposed": 5,
     "actionsCompleted": 4,
     "summary": "<agent-generated summary>"
   }
   ```
3. Best-effort fire-and-forget with single retry. If it fails, the session data remains in Bob's DB and can be reconciled later.

Token/cost tracking: add a `Ref` accumulator (same pattern used for turn state in sendTurn) that sums `input_tokens` + `output_tokens` from adapter events. On close, read the ref and compute cost from model pricing stored in persona config.

## Part 4: New RPC Procedures for Persona CRUD

**Modify:** `packages/core/src/contracts/groups/agent.ts`

Add five new RPCs to the AgentRpc group:

```typescript
// agent.persona.create
export const AgentPersonaCreateRpc = Rpc.make("agent.persona.create", {
  payload: Schema.Struct({
    name: Schema.String,
    slug: Schema.String,
    adapterId: Schema.String,
    model: Schema.optional(Schema.String),
    systemPrompt: Schema.optional(Schema.String),
    allowedTools: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
    autonomyLevel: Schema.optional(Schema.String),
    budgetLimitCents: Schema.optional(Schema.Number),
    projectId: Schema.optional(Schema.String),
    externalAgentSlug: Schema.optional(Schema.String),
    bizpulseApiUrl: Schema.optional(Schema.String),
    bizpulseApiKey: Schema.optional(Schema.String),
  }),
  success: AgentPersonaSchema,
});

// agent.persona.list
export const AgentPersonaListRpc = Rpc.make("agent.persona.list", {
  payload: Schema.Struct({
    projectId: Schema.optional(Schema.String),
    active: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Array(AgentPersonaSchema),
});

// agent.persona.get
export const AgentPersonaGetRpc = Rpc.make("agent.persona.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: AgentPersonaSchema,
  error: NotFoundError,
});

// agent.persona.update
export const AgentPersonaUpdateRpc = Rpc.make("agent.persona.update", {
  payload: Schema.Struct({
    id: Schema.String,
    name: Schema.optional(Schema.String),
    // ... same optional fields as create
  }),
  success: AgentPersonaSchema,
  error: NotFoundError,
});

// agent.persona.delete (soft-delete: sets active=false)
export const AgentPersonaDeleteRpc = Rpc.make("agent.persona.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: NotFoundError,
});
```

Add `AgentPersonaSchema` to `packages/core/src/contracts/schemas/` following the existing pattern (e.g. `agent-session.ts`).

Wire handlers in `packages/bob/src/api/src/rpc-handlers/` following the existing agent handler pattern.

## Part 5: Blder UI Additions

**App:** `apps/blder/`
**Current routes:** `api/`, `login/`, `nodes/`

Add new routes:

- `apps/blder/src/app/personas/page.tsx` -- list all registered personas
  - Table columns: name, slug, adapter, model, project, autonomy level, active status
  - Filter by active/inactive, project
  - Create button -> form

- `apps/blder/src/app/personas/[id]/page.tsx` -- persona detail
  - Profile: name, description, adapter, model, system prompt preview
  - BizPulse linkage: external agent slug, mandate ID, API URL
  - Recent sessions that used this persona (query chatConversations where metadata.personaId matches)
  - Edit button -> inline form

- `apps/blder/src/app/personas/new/page.tsx` -- create persona form
  - All fields from the create RPC
  - System prompt as a resizable textarea
  - Allowed tools as a tag input

## Part 6: gmacko-ops Management Repo

New repo on git.forgegraf.com: `gmacko-ops`

### Repository structure

```
gmacko-ops/
  CLAUDE.md                    -- agent instructions for operating in this repo

  playbooks/
    customer-validation.md     -- interview script + survey template
    landing-page-audit.md      -- SEO + conversion checklist
    compliance-check.md        -- entity + filing status verification
    launch-readiness.md        -- pre-launch checklist (Stripe, legal, marketing)
    kb-update.md               -- sync gmacko-company docs -> BizPulse KB
    weekly-portfolio-review.md -- portfolio-wide status review
    competitor-scan.md         -- market research update

  skills/                      -- Bob/blder skill packs (executable by agents)
    bizpulse-context.md        -- skill: fetch startup context from BizPulse API
    bizpulse-report.md         -- skill: report results back to BizPulse
    repo-health-check.md       -- skill: check a startup's repo for CI, tests, deps

  personas/                    -- canonical persona definitions (source of truth)
    growth-agent.yaml
    compliance-agent.yaml
    devops-agent.yaml
    research-agent.yaml

  templates/
    persona.template.yaml
    playbook.template.md

  scripts/
    sync-personas.ts           -- sync persona YAML -> Bob API + BizPulse API
    seed-agents.ts             -- create agent records in BizPulse from persona defs
```

### Persona YAML format

```yaml
name: Growth Agent
slug: growth-agent
description: Drives user acquisition, activation, and retention across portfolio startups
adapter: claude-code
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

playbooks:
  - customer-validation
  - landing-page-audit
  - competitor-scan
```

### Sync script design

`scripts/sync-personas.ts` reads all `personas/*.yaml` files and:

1. **Parses** each YAML file, validates against the persona schema
2. **Upserts to Bob** via Bob's API: calls `agent.persona.create` or `agent.persona.update` (matching by slug)
3. **Upserts to BizPulse** via BizPulse's API: calls `agent.create` or `agent.update` (matching by slug)
4. **Cross-links** the records:
   - Sets `externalPersonaId` on the BizPulse agent record (pointing to Bob's persona ID)
   - Sets `externalAgentSlug` on the Bob persona record (pointing to BizPulse's agent slug)
5. **Outputs** a summary table: persona name, Bob ID, BizPulse agent ID, status (created/updated/unchanged)

CLI usage: `npx tsx scripts/sync-personas.ts --bob-url https://blder.gmac.io --bizpulse-url https://bizpulse.gmac.io --bob-key $BOB_API_KEY --bizpulse-key $BIZPULSE_API_KEY`

The script is idempotent -- running it twice with the same YAML produces no changes.

## Implementation Order

### Phase A: Bob persona schema + CRUD (no BizPulse dependency)
1. Create `packages/core/src/db/schema/agent-personas.ts` with pgTable definition
2. Add re-export to `packages/core/src/db/schema/index.ts`
3. Run `drizzle-kit push` to create the table
4. Add `AgentPersonaSchema` to `packages/core/src/contracts/schemas/`
5. Add five persona RPCs to `packages/core/src/contracts/groups/agent.ts`
6. Wire RPC handlers in `packages/bob/src/api/src/rpc-handlers/`
7. Verify: `tsc --noEmit` clean, persona CRUD works via RPC

### Phase B: Persona resolution in session creation
1. Extend `CreateSessionInput` with optional `personaId`
2. Add persona lookup logic to `AgentSession.create()` in `packages/core/src/agent/agent-session.ts`
3. Extend `AgentCreateSessionRpc`, `AgentSessionCreateRpc`, `AgentSessionBootstrapForChatRpc` payloads
4. Verify: create a session with `personaId`, confirm persona config applied

### Phase C: BizPulse push on session completion
1. Add token/cost accumulator `Ref` to sendTurn
2. Add HTTP POST to BizPulse in close/cancel/fail paths
3. Verify: complete a persona-linked session, confirm BizPulse receives session report

### Phase D: Blder UI
1. Add `/personas` list page
2. Add `/personas/[id]` detail page
3. Add `/personas/new` create form
4. Wire tRPC calls to persona CRUD RPCs

### Phase E: gmacko-ops repo + sync
1. Create `gmacko-ops` repo on git.forgegraf.com
2. Define initial persona YAML files (growth, compliance, devops, research)
3. Write `sync-personas.ts` script
4. Test end-to-end: persona YAML -> Bob persona -> agent session -> BizPulse attribution

## Key Files Summary

| What | Path |
|------|------|
| Persona DB schema (new) | `packages/core/src/db/schema/agent-personas.ts` |
| Schema barrel | `packages/core/src/db/schema/index.ts` |
| Agent session service | `packages/core/src/agent/agent-session.ts` |
| RPC contracts | `packages/core/src/contracts/groups/agent.ts` |
| RPC schemas | `packages/core/src/contracts/schemas/` |
| RPC handlers | `packages/bob/src/api/src/rpc-handlers/` |
| Blder app routes | `apps/blder/src/app/` |
| Management repo | `gmacko-ops/` (git.forgegraf.com) |
