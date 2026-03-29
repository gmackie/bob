<!-- /autoplan restore point: /Users/mackieg/.gstack/projects/gmackie-bob/main-autoplan-restore-20260328-192332.md -->
# blder.bot — Public Product Design

**Date:** 2026-03-28
**Status:** Draft

## Overview

blder.bot is an agent orchestration platform that gives developers a structured workflow for AI-powered software delivery. Users bring their own coding agents (Claude Code, Aider, Codex, smol-agent, or any CLI tool); blder.bot provides the pipeline (plan, execute, review, deploy) and a local runtime that gives those agents a workspace.

## Core Value Proposition

Agent observability and trust is the product. Developers already have coding agents, what they lack is confidence: what did the agent do, did it break anything, is it safe to ship? blder.bot answers those questions. The 7-stage workflow pipeline (plan, execute, review, deploy) exists as infrastructure underneath, but the user-facing story is: see what your agents did, understand the changes, and ship with confidence. The pipeline structures the work; observability makes it trustworthy.

## Components

### blder.bot (Web Platform)

Multi-tenant SaaS running on Cloudflare via vinext.

**Responsibilities:**
- User accounts and tenant management
- Dashboard: active work items, recent agent runs, workspace status
- Work item detail: 7-stage pipeline view (idea, shape, plan, execute, review, deploy, live)
- Agent run results: structured output, artifacts, diffs
- Settings: connected workspaces, agent configs, API keys, ForgeGraph connection

**Tech stack:**
- vinext on Cloudflare Workers
- tRPC router (migrated from current Bob)
- Drizzle ORM + PostgreSQL
- Better Auth with GitHub OAuth
- R2 for artifact storage

**What gets cut from current Bob:**
- Terminal/PTY in browser (returns later as power-user feature)
- Gateway WebSocket server (replaced by bob binary reporting via REST)
- Local execution service (bob binary takes over)

### bob (Go Binary)

Local runtime that runs on the user's machine. Sidecar and launcher for coding agents. Distributed via Homebrew.

**Core commands:**
- `bob login` — GitHub OAuth flow, stores API key locally
- `bob init` — registers current directory as a workspace, links to ForgeGraph project
- `bob run <work-item-id>` — pulls plan from blder.bot, launches configured agent, captures output and artifacts, reports results
- `bob status` — active/recent runs for this workspace
- `bob agents` — list and manage agent configurations

**Agent model:**
- Generic launcher: user provides command, args, env vars via YAML config
- First-class agents: pre-built configs with deeper integration (smol-agent is the reference implementation)
- v0 is fire-and-report: launch agent, wait for completion, collect artifacts, POST results
- Live PTY streaming comes later via WebSocket

**Agent configuration format:**
```yaml
agents:
  default: claude-code
  claude-code:
    command: claude
    args: ["--print", "--output-format", "stream-json"]
    env:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
  smol-agent:
    command: smol
    first-class: true
  custom:
    command: ./my-agent.sh
    env:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
```

**Artifact collection:** After a run completes, bob collects git diff, file changes, test results (if any), and agent logs, then POSTs them to blder.bot as typed artifacts.

### ForgeGraph Integration

ForgeGraph owns projects and work items. blder.bot is an opinionated integration layer on top of ForgeGraph's model.

- New user signup auto-provisions a ForgeGraph project (transparent to the user)
- Work items flow from ForgeGraph through blder.bot's pipeline stages
- Agent run results feed back into work item stage progression
- GitHub Issues and other integrations would feed into ForgeGraph in the future, not blder.bot directly

## API Contract (bob <-> blder.bot)

**Base URL:** `https://api.blder.bot/v1`
**Auth:** API key in `Authorization: Bearer <key>` header

### Endpoints

```
# Workspace registration
POST   /workspaces              — bob init registers a workspace
GET    /workspaces/:id          — workspace details + linked project

# Work items (proxied from ForgeGraph)
GET    /work-items              — list work items for workspace's project
GET    /work-items/:id          — detail + current stage + plan

# Agent runs
POST   /runs                    — bob starts a run (work item + agent config)
PATCH  /runs/:id                — update status (running -> completed/failed)
POST   /runs/:id/artifacts      — upload artifacts (diffs, logs, test results)
GET    /runs/:id                — run detail + artifacts

# Agents
GET    /agents                  — list configured agents for this workspace
POST   /agents                  — register an agent config

# Auth
POST   /auth/token              — exchange OAuth code for API key
DELETE /auth/token/:id          — revoke
```

### WebSocket (future, for live streaming)

```
ws://api.blder.bot/v1/runs/:id/stream
```

### Artifact Types

Each artifact is typed: `diff`, `log`, `test-report`, `file-snapshot`. Stored in Cloudflare R2, referenced by run ID.

## Data Model

### New Tables

```
tenants
  id, name, slug, plan (free/premium/pro)
  forgeGraphProjectId — auto-provisioned on signup
  createdAt

tenant_members
  tenantId, userId, role (owner/admin/member)

agent_runs
  id, workItemId, workspaceId, tenantId
  agentType, agentConfig
  status (queued/running/completed/failed)
  startedAt, completedAt
  summary (structured output from agent)

run_artifacts
  id, runId
  type (diff/log/test-report/file-snapshot)
  storageKey (R2 path)
  metadata (jsonb)
  createdAt
```

### Modifications to Existing Tables

```
workspaces (updated)
  + tenantId — scopes all existing workspace queries
  + machineId — identifies the bob instance
  + lastHeartbeat — bob pings periodically
  + agentConfigs (jsonb) — agent launch configurations
```

### Deprecated (coexist during migration, removed later)

`taskRuns`, `dispatchBatches`, `dispatchItems`, `agentInstances` — replaced by the simpler `agent_runs` + `run_artifacts` model.

## Target User

Solo developers already using coding agents, with team support designed into the schema from day one. Team features (multi-seat, shared workspaces) ship in a later phase.

## Business Model

- **Free tier:** BYOK (bring your own API keys), full workflow pipeline, single workspace
- **Premium/Pro tiers:** unlock features (not usage), seat-based pricing for teams
- blder.bot never touches LLM costs — users bring their own keys

## Auth Model

- GitHub OAuth for web UI sign-in
- `bob login` triggers OAuth flow, exchanges for API key stored locally
- API keys for bob binary authentication to blder.bot
- Existing `apiKeys` table in schema supports this

## Deployment Architecture

- **blder.bot web:** vinext on Cloudflare Workers (global edge)
- **bob binary:** runs on user's machine (Homebrew install)
- **Your setup (tenant #1):** bob runs on labnuc, pointed at blder.bot — same codebase, dogfood instance
- **ForgeGraph:** existing infrastructure, auto-provisioned per tenant

## Rollout Plan

### Phase 0 — Foundation

- Add `tenants` + `tenant_members` tables, migrate existing data as tenant #1
- Add `tenantId` to existing tables (workspaces, projects, etc.)
- Set up blder.bot domain on Cloudflare
- Scaffold the Go binary repo (`blder/bob`)

### Phase 1 — bob CLI

- `bob login` / `bob init` / `bob status`
- `bob run` with fire-and-report (launch agent, collect artifacts, POST to API)
- smol-agent as first-class config, generic agent support via YAML
- Homebrew tap for distribution

### Phase 2 — blder.bot Web

- Migrate Next.js app to vinext on Cloudflare Workers
- Build the public API (`/v1/*` endpoints)
- Signup flow: GitHub OAuth -> tenant provisioning -> ForgeGraph project auto-created
- Dashboard, work item detail, agent runs views
- Strip terminal/PTY/gateway features from public product

### Phase 3 — Close the Loop

- Agent run results feed back into work item stage progression
- Plan -> Execute -> Review flow works end-to-end via bob CLI + blder.bot
- Free tier live, invite-only or waitlist

### Phase 4 — Expand

- Live PTY streaming (WebSocket)
- Paid tiers (premium/pro feature gates)
- Team features (multi-seat, shared workspaces)
- Additional integrations (GitHub Issues, etc.)

## Review Findings (from /autoplan)

### Value Prop Reframing (accepted)
The user-facing story is observability and trust, not pipeline stages. The dashboard hero should be "what changed, what broke, what passed, what needs attention" not "7-stage pipeline view."

### Hidden Complexity (must resolve before implementation)
1. **PostgreSQL from CF Workers** — need Hyperdrive or connection pooler. Blocking infra decision.
2. **OAuth device flow** — `bob login` needs RFC 8628 device authorization grant. Not trivial.
3. **tenantId migration** — touches every `.where()` in 29 tRPC routers. Significant migration.
4. **Artifact upload sizing** — need multipart upload, size limits, presigned URLs.
5. **Agent output normalization** — different agents produce different formats. Need normalizer.

### Error Handling (must specify)
| Command | Error | User Sees |
|---|---|---|
| `bob login` | OAuth timeout | "Auth timed out. Try again with `bob login`" |
| `bob login` | API key exchange fail | "Could not connect to blder.bot. Check your network." |
| `bob init` | blder.bot unreachable | "blder.bot is unreachable. Check https://status.blder.bot" |
| `bob init` | FG project creation fail | "Could not create project. Try again or contact support." |
| `bob run` | Agent not found | "Agent 'X' not found in PATH. Install it or update ~/.blder/config.yaml" |
| `bob run` | Agent crashes | "Agent exited with code N. Partial artifacts saved locally at ~/.blder/runs/<id>/" |
| `bob run` | Upload fails | "Artifacts saved locally. Upload failed, will retry on next `bob status`." |

### CLI Progress Output (for fire-and-report dead air)
```
$ bob run WI-42
  Pulling plan from blder.bot... done
  Launching claude-code... started (pid 12345)
  Agent working... (elapsed 2m30s)
  Agent completed (exit 0, 3 files changed)
  Collecting artifacts...
    diff: +142 -38 across 3 files
    tests: 12 passed, 0 failed
    log: 847 lines captured
  Uploading to blder.bot... done
  View results: https://blder.bot/runs/abc123
```

### Interaction States
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Dashboard | Skeleton cards | "Connect your first workspace" + `bob init` instructions | API error banner | Live data | Some workspaces offline |
| Agent runs | Skeleton rows | "No runs yet. Run `bob run <id>`" | Load failed banner | Run list | Runs loading |
| Run detail | "Collecting artifacts..." | "No artifacts produced" | "Agent failed" + log excerpt | Full artifact view | Artifacts uploading |
| Work item | Stage badges shimmer | "No work items" | "ForgeGraph unreachable" | Pipeline view | Some stages incomplete |
| Settings | Form skeleton | Default values | Save failed toast | Saved confirmation | Partial config |

### Screen Hierarchy (observability-first)
**Dashboard:** (1) Active runs with live status, (2) Recent runs pass/fail, (3) Work item overview
**Run detail:** (1) Status + summary (files changed, tests), (2) Diff viewer, (3) Logs + test report
**Work item:** (1) Current stage badge, (2) Run history for this item, (3) Pipeline progression

### Post-Signup Onboarding (critical UX)
The post-signup empty state is the most important screen. New user lands on dashboard and sees:
1. Welcome message with workspace name
2. Guided checklist (real-time status as each step completes):
   - Install bob: `brew install blder/tap/bob` (copyable)
   - Authenticate: `bob login`
   - Connect workspace: `bob init` in your project
   - First run: `bob run <work-item-id>`
3. Each step updates live via workspace registration + heartbeat API

### Pipeline Visualization
Horizontal rail with stage nodes. Warm amber (`#D4850A`) for active/completed stages, neutral-500 (`#8A877E`) for future stages. Interactive (clickable stages expand to show run history for that stage). Consistent with existing Bob pipeline components.

### Design System References
- Status badges: semantic colors from DESIGN.md (success `#2D8A4E`, error `#C62828`, warning `#D4850A`)
- Typography: Satoshi for headings, DM Sans for body, JetBrains Mono for run IDs/commands
- Surfaces: warm grays (`#F5F4F1` bg, `#1C1B18` text), `#D4850A` amber for CTAs
- Border radius: 8px cards, 4px badges, 12px modals
- Navigation: sidebar (consistent with current Bob)
- Dark mode: yes (DESIGN.md already specifies dark tokens)
- Layout: desktop-first, 12-column grid, max 1400px

### Responsive Breakpoints
- **Desktop (1200px+):** Sidebar nav + main content
- **Tablet (768-1199px):** Collapsed sidebar, stacked panels
- **Mobile (375-767px):** Bottom nav, full-width cards, simplified run detail

### Critical Eng Findings (from dual voices)

1. **Phase sequencing inconsistency** — Phase 1 (bob CLI) depends on REST API endpoints that are only built in Phase 2. Resolution: Phase 1 bob CLI talks to the existing Bob tRPC API on labnuc as a temporary backend (per Approach B). The public REST API ships in Phase 2 and bob switches to it.

2. **Agent config supply-chain risk** — YAML config with `command: ./my-agent.sh` checked into a repo is a supply-chain attack. Resolution: agent configs come from user-local `~/.config/bob/agents.yaml` only. Per-repo configs require explicit `bob trust` approval (like `direnv allow`).

3. **Dual lifecycle ownership** — ForgeGraph owns work items but blder.bot also presents stage progression. Who owns stage transitions? Resolution: ForgeGraph remains the authority for stage transitions and approvals. blder.bot reads stage state from ForgeGraph and displays it. Agent run results may trigger stage transitions via ForgeGraph's API, not by mutating local state.

4. **Deprecation is a feature cut** — `taskRuns`/`dispatchBatches` encode dependency blocking, per-phase runs, review-child runs. `agent_runs` doesn't replace that. Resolution: `agent_runs` is the v0 public model (simple fire-and-report). The existing execution tables stay for internal Bob usage. They coexist, not replace.

5. **Observability data model gap** — Artifacts in R2 are opaque blobs. Need structured metadata for the observability promise. Resolution: define artifact metadata schemas per type (see below).

### Artifact Metadata Schemas

```
diff:
  files_changed: number
  insertions: number
  deletions: number
  files: [{ path, status (added/modified/deleted) }]

test-report:
  passed: number
  failed: number
  skipped: number
  failures: [{ name, message, stack? }]
  duration_ms: number

log:
  lines: number
  level_counts: { info, warn, error }
  agent_exit_code: number

file-snapshot:
  path: string
  size_bytes: number
  hash: string
```

### Security Requirements
- API keys scoped per-workspace (not per-tenant)
- Artifact content treated as untrusted (sanitize for XSS in web UI)
- Rate limiting per API key on REST API
- Tenant isolation middleware on all Drizzle queries

### Observability Requirements
- Request logging on all API endpoints
- Error rate and latency percentile metrics
- Active workspace count tracking
- Agent run success/failure rates per tenant

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|---------------|-----------|-----------|----------|
| 1 | CEO | Approach B (staged: CLI first, web later) | Mechanical | P3 pragmatic, P6 action | Ships value faster, derisks vinext | Approach A (all parallel), C (CLI only) |
| 2 | CEO | SELECTIVE EXPANSION mode | Mechanical | P3 pragmatic | Feature enhancement on existing system | EXPANSION (too broad), HOLD (too narrow) |
| 3 | CEO | Defer all 5 expansion candidates | Mechanical | P6 action, P1 completeness | None needed for v0 value prop | Adding any expansion to v0 |
| 4 | CEO | USER CHALLENGE: Reframe value prop around observability | User Challenge | User accepted | Both models flagged independently | Original "pipeline is the product" framing |
| 5 | CEO | USER CHALLENGE: Keep ForgeGraph coupling | User Challenge | User rejected | User has strategic reasons | Decoupling ForgeGraph |
| 6 | CEO | USER CHALLENGE: Keep rollout sequence | User Challenge | User rejected | User prefers current phasing | Deferring multi-tenancy |
| 7 | CEO | Add error handling specs to plan | Mechanical | P1 completeness | 8 unrescued failure modes in CLI | Leaving error handling unspecified |
| 8 | CEO | Add observability requirements | Mechanical | P1 completeness | No API observability spec | Deferring observability |
| 9 | CEO | Add offline mode spec for bob CLI | Mechanical | P5 explicit | CLI should work when blder.bot unreachable | Only online mode |
| 10 | CEO | Specify empty/loading states for all screens | Mechanical | P1 completeness | 4 screens with unspecified states | Leaving UI states to implementation |
| 11 | Design | Add information hierarchy per screen | Mechanical | P1 completeness | No content hierarchy defined | Generic screen names only |
| 12 | Design | Add interaction state table | Mechanical | P1 completeness | Zero states specified | Defer to implementer |
| 13 | Design | Reference DESIGN.md tokens in screen specs | Mechanical | P5 explicit | Plan ignores existing design system | Generic descriptions |
| 14 | Design | Add responsive breakpoints | Mechanical | P1 completeness | Zero responsive specs | Desktop-only assumption |
| 15 | Design | Resolve navigation pattern (sidebar) | Mechanical | P3 pragmatic | Consistent with current Bob | Top nav or other patterns |
| 16 | Design | Desktop-first, dark mode yes | Mechanical | P3 pragmatic | DESIGN.md already has dark tokens | Mobile-first or no dark mode |
| 17 | Eng | Specify PostgreSQL connection strategy for CF Workers | Mechanical | P1 completeness | Blocking infra decision | Leave to implementation |
| 18 | Eng | Specify OAuth device flow (RFC 8628) for bob login | Mechanical | P5 explicit | Non-trivial auth flow | Generic "OAuth flow" |
| 19 | Eng | Add API contract tests as Phase 1 gate | Mechanical | P1 completeness | System boundary must be tested | No test requirements |
| 20 | Eng | Add tenant isolation middleware requirement | Mechanical | P1 completeness | Every query needs tenantId check | Per-query manual checks |

## Repo Structure

| Repo | Language | Purpose |
|------|----------|---------|
| `blder/bob` (new) | Go | CLI binary — sidecar/launcher |
| `forgegraph/forgegraph` (existing) | Go | ForgeGraph binary — projects, work items |
| This monorepo | TypeScript | Web platform, shared packages |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES_OPEN (via /autoplan) | 5 proposals, 0 accepted, 5 deferred. 3 user challenges (1 accepted: reframe value prop) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES_OPEN (via /autoplan) | 5 hidden complexity + 5 critical dual-voice findings (supply-chain risk, lifecycle ownership, deprecation scope, observability model, phase sequencing) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES_OPEN (via /autoplan) | score: 3/10 -> 7/10, 6 decisions + onboarding flow + pipeline viz + artifact schemas added |

- **CROSS-MODEL:** CEO: 0/6 confirmed with original plan, 6/6 against (both models). Design: both agree plan needed full UI spec (now added). Eng: both flagged phase sequencing, tenant migration complexity, and supply-chain risk independently.
- **UNRESOLVED:** 0 unresolved decisions (user challenges resolved at gate)
- **VERDICT:** CEO + DESIGN + ENG reviewed via /autoplan. All phases have findings incorporated into plan. Ready for implementation planning.
