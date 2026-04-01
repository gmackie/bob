# Bob Ownership Consolidation — Design Document

**Date:** 2026-03-29
**Status:** Draft
**Supersedes:** agent-runs-web-ui-plan, phase3-close-the-loop-plan, phase4-launch-readiness-plan, bob-forgegraph-work-item-boundary

## Overview

Bob (blder.bot) becomes the canonical owner of work items. ForgeGraph owns app definitions (1:1 with git repos). Threads get branch enforcement. The deployment moves from labnuc to Cloudflare Workers with vinext, backed by ForgeGraph's Postgres on Hetzner master via WireGuard over Cloudflare Tunnel.

This is the consolidation plan for blder.bot as a product: one plan covering platform migration, data ownership, thread model, agent runs UI, and launch readiness.

## Why This Change

Two reasons drove this:

1. **Bob is the user-facing product.** Work items belong where users create and manage them. ForgeGraph is infrastructure — repos, CI, deploy, monitoring. The user's workspace is Bob.

2. **The split was too complex.** Having ForgeGraph own work items while Bob owned planning and execution created two control planes with complex sync. Consolidating work items in Bob simplifies the data flow. ForgeGraph stays authoritative for what it's good at: apps, repos, builds, deploys.

## Architecture

Three components with clear ownership:

### blder.bot web (vinext on Cloudflare Workers)
The user-facing product. Dashboard, work items, agent runs, threads.

- vinext on Cloudflare Workers
- tRPC router (migrated from current Bob monorepo)
- Drizzle ORM + PostgreSQL (Hetzner master, same as ForgeGraph)
- Better Auth with GitHub OAuth
- R2 for artifact storage
- Connected to Postgres via WireGuard over Cloudflare Tunnel

### bob CLI (Go binary, runs locally)
Agent launcher. Runs on the user's machine. Distributed via Homebrew.

- `bob login` — auth flow
- `bob init` — register workspace, link to app
- `bob run <work-item-id>` — launch agent, capture output, report results
- `bob thread new <branch>` — create thread with worktree
- `bob status` — active runs and threads

### ForgeGraph (forge.gmac.io)
Infrastructure layer. Owns app definitions.

- Apps (1:1 with git.gmac.io repos)
- Repo metadata, test credentials, CI config
- Build/deploy/monitoring facts
- Consumes work items from Bob's API for display
- Creates work items in Bob from automated alerts

## Data Ownership

| Domain | Owner | Consumers |
|--------|-------|-----------|
| Work items | Bob | ForgeGraph (read + create from alerts) |
| Threads (chat conversations) | Bob | — |
| Agent runs + artifacts | Bob | — |
| Workspaces + tenants | Bob | — |
| Planning sessions | Bob | — |
| Apps (repos, creds, CI config) | ForgeGraph | Bob (cached in projects table) |
| Builds + deployments | ForgeGraph | Bob (read for stage progression) |
| Monitoring alerts | ForgeGraph | Bob (creates work items) |

## Data Model Changes

### Projects (evolve existing table)

Add required `forgeGraphAppId` field (unique, not null). Every project must map 1:1 to a ForgeGraph app. No orphan projects.

Additional synced fields: `repoUrl`, `defaultBranch` (populated from ForgeGraph).

On login or refresh, Bob calls ForgeGraph's app list API and upserts the local projects table. Projects that exist locally but not in ForgeGraph are flagged or removed.

### Work Items (Bob becomes canonical)

Remove ForgeGraph-as-source sync logic. The `externalId` field becomes optional metadata (for cross-referencing), not the source of truth.

Work items keep their existing schema: `id`, `parentId`, `workspaceId`, `projectId`, `kind`, `title`, `description`, `status`, plus timestamps and user references.

Bob exposes work item CRUD via the public API. ForgeGraph uses standard API key auth to read and create work items.

### Threads (evolve chatConversations)

Add fields:
- `branch` (text, required) — the git branch this thread operates on
- `mode` (enum: "planning" | "full") — auto-set based on branch

Mode rules:
- Branch is main or master → mode = "planning"
- Any other branch → mode = "full"

Planning mode restrictions:
- Read-only access to all files
- Write access restricted to `./docs/` directory
- Can create/update work items
- Cannot run agents that modify code

Feature branch threads:
- Full read/write access
- Associated with a worktree (created automatically or by bob CLI)
- Warning on duplicate branch threads (query before creation, warn but allow)

### Agent Runs (strengthen work item link)

`workItemId` stays as text for flexibility. Add validation on creation: resolve against local work items table. Runs display on both /runs page and work item detail page.

## Agent Configuration

Three config locations:

### Repo-level: `.bob/config.yaml` (checked into git, shared with team)
```yaml
agents:
  default: claude-code
  claude-code:
    command: claude
    args: ["--print", "--output-format", "stream-json"]
  smol-agent:
    command: smol
    first-class: true
  custom:
    command: ./my-agent.sh

build:
  command: pnpm build
test:
  command: pnpm test
lint:
  command: pnpm lint
```

### Server-side: Bob (per-user/per-tenant)
- API keys for agent providers (stored encrypted)
- Default agent preference per user
- Workspace registration, heartbeat
- Run history, artifacts, telemetry
- Thread state, branch associations
- Work item assignments

### Local machine: `~/.bob/` (bob CLI config)
- Auth token for blder.bot
- Machine-specific paths
- Local agent binary locations

## API Surface

### Public API (consumed by bob CLI, ForgeGraph, other clients)

```
# Auth
POST   /v1/auth/login              — OAuth flow, returns API key
POST   /v1/auth/api-keys           — generate API key

# Apps (proxied from ForgeGraph, cached locally)
GET    /v1/apps                     — list apps from ForgeGraph
GET    /v1/apps/:appId              — app detail with repo metadata

# Work Items (Bob is canonical)
GET    /v1/work-items               — list (filterable by app/status/assignee)
POST   /v1/work-items               — create
GET    /v1/work-items/:id           — detail with runs, artifacts, stage
PATCH  /v1/work-items/:id           — update
DELETE /v1/work-items/:id           — soft delete

# Threads
POST   /v1/threads                  — create (requires branch name)
GET    /v1/threads                  — list for user
GET    /v1/threads/:id              — detail with messages

# Agent Runs
POST   /v1/runs                     — create run (from bob CLI)
PATCH  /v1/runs/:id                 — update status, summary
GET    /v1/runs                     — list runs
GET    /v1/runs/:id                 — detail with artifacts
POST   /v1/runs/:id/artifacts       — upload artifact

# Workspaces
POST   /v1/workspaces               — register (bob init)
POST   /v1/workspaces/:id/heartbeat — keep-alive
```

### ForgeGraph Integration

- Bob calls ForgeGraph app list API → upserts local projects
- Bob reads CI/deploy/monitoring facts from ForgeGraph for stage progression
- ForgeGraph calls `POST /v1/work-items` with service API key to create from alerts
- ForgeGraph calls `GET /v1/work-items` to display in its dashboards

Auth: standard API key. ForgeGraph gets a service-level key. No special trust model.

### Future: Build in Public

Per-project setting to make work items publicly readable without auth. Scoped to read-only access on work items and runs for a specific app. Not in v1 scope.

## Implementation Phases

### Phase 1: Cloudflare/vinext Migration

Move blder.bot from labnuc (Next.js on NUC) to Cloudflare Workers with vinext.

- Migrate tRPC routes to vinext on Cloudflare Workers
- Connect to ForgeGraph's Postgres on Hetzner master via WireGuard over Cloudflare Tunnel
- R2 for artifact storage (replace local filesystem)
- DNS: blder.bot → Cloudflare Workers
- Migrate Better Auth + GitHub OAuth
- Verify all existing functionality works on new platform
- Decommission labnuc deployment

### Phase 2: Data Model & Ownership

Restructure data ownership with Bob as canonical source.

- Add `forgeGraphAppId` to projects table (required, unique, 1:1 with FG apps)
- Build ForgeGraph app sync service (login/refresh → upsert projects)
- Remove ForgeGraph-as-source work item sync logic
- Add `branch` and `mode` fields to chatConversations
- Expose work item CRUD via public REST API (for ForgeGraph consumption)
- Create service API key mechanism for ForgeGraph

### Phase 3: Thread Model & Branch Enforcement

Implement planning-mode restrictions and worktree management.

- Planning mode middleware: check thread mode before allowing mutations
- Auto-detect mode from branch name (main/master → planning)
- Worktree creation for feature branch threads
- Duplicate branch warning on thread creation
- Bob CLI: `bob thread new`, `bob thread list`, `bob thread switch`
- Write access restriction in planning mode (only `./docs/`)

### Phase 4: Agent Runs UI + Close the Loop

Build the observability surface and connect runs to work items.

- Runs list page (`/runs`) with status badges, filters, relative time
- Run detail page (`/runs/[runId]`) with artifacts, summary cards, metadata
- Agent runs panel on work item detail page
- Bidirectional links: work items ↔ runs
- Recent runs dashboard widget
- Sidebar nav: add "Runs" item
- Work item stage progression from run status

### Phase 5: Launch Readiness

Self-service onboarding for new users.

- Auto-create tenant on first authenticated request
- Onboarding empty state with setup checklist (install bob, generate API key, init, run)
- `/runs` as default landing page
- `.bob/config.yaml` project init flow in bob CLI
- End-to-end verification: signup → onboard → first run → see results

## What Gets Cut From Current Bob

- Terminal/PTY in browser (returns later as power-user feature)
- Gateway WebSocket server (bob CLI reports via REST instead)
- Local execution service on labnuc (bob CLI takes over)
- ForgeGraph-as-source work item sync
- Project creation without ForgeGraph app

## Migration Notes

- Existing work items in Bob's DB are preserved and become canonical
- Existing ForgeGraph work items continue to exist in ForgeGraph but are no longer synced TO Bob
- ForgeGraph will need to call Bob's API to access work items going forward
- The `externalId` field stays for historical cross-referencing but is no longer the sync mechanism
- Labnuc deployment is decommissioned after Phase 1 is stable
