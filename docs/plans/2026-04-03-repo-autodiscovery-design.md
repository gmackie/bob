# Repo Autodiscovery & ForgeGraph Onboarding

**Date:** 2026-04-03
**Status:** Design approved

## Problem

Bob running as a daemon on labnuc has no awareness of repos on disk. Users must manually create projects and link repos. We want the daemon to autodetect repos in a configurable directory, classify them by ForgeGraph status, and surface them in the UI with appropriate onboarding actions.

## Design

### Daemon Startup Sequence

The gateway daemon starts with `DEV_DIR` (env var or `--dev-dir` flag, default `/home/mackieg/dev`).

1. **Validate `DEV_DIR`** — confirm directory exists and is readable
2. **Detect `forge` CLI** — check `~/.forgegraph/bin/fg` exists and is executable
3. **Check forge auth** — run `forge auth status`. If unauthenticated or missing, emit a `forgeNotice` event rendered as a dismissable banner in the UI
4. **If forge authenticated** — run `forge app list` to get registered apps (cached, refreshed each heartbeat). Generate/retrieve a ForgeGraph API key via `forge api-key create`, store in workspace record
5. **Initial scan** — walk top-level subdirectories of `DEV_DIR` (shallow, no recursion). For each dir:
   - Check for `.git/` → if missing, mark as `not_git`
   - If git: read remote URL (`git remote get-url origin`), current branch, dirty state (`git status --porcelain`), detect build system (package.json, go.mod, Cargo.toml, Makefile, etc.)
   - Match remote URL against cached forge app list → set `forgeAppId` if matched
6. **Send first heartbeat** with full repo payload
7. **Begin heartbeat loop** — repeat scan + heartbeat every 30s

### Heartbeat Payload

Expanded from current `{ agentTypes }` to include repo scan results:

```json
{
  "agentTypes": ["claude", "codex"],
  "forgeAvailable": true,
  "repos": [
    {
      "name": "bob",
      "path": "/home/mackieg/dev/bob",
      "remoteUrl": "git+https://gitea.forge.gmac.io/mackieg/bob",
      "forgeAppId": "abc123",
      "branch": "main",
      "dirty": false,
      "buildSystem": "node"
    },
    {
      "name": "my-site",
      "path": "/home/mackieg/dev/my-site",
      "remoteUrl": "git+https://...",
      "forgeAppId": null,
      "branch": "main",
      "dirty": true,
      "buildSystem": "go"
    },
    {
      "name": "notes",
      "path": "/home/mackieg/dev/notes",
      "isGit": false
    }
  ]
}
```

### Repo Classification (4 statuses)

| Status | Color | Criteria | Action |
|--------|-------|----------|--------|
| **Linked** | Green | Git repo + ForgeGraph app + existing Bob project | None — fully managed |
| **ForgeGraph-ready** | Blue | Git repo + ForgeGraph app + NO Bob project | Auto-create project |
| **Git-only** | Yellow | Git repo + no ForgeGraph match | Discovery queue — user can register |
| **Not a repo** | Red | No `.git/` directory | Warning, informational only |

### API-Side Processing

On each heartbeat with repos:

1. **Update workspace** — `lastHeartbeat`, `agentConfigs`, `forgeAvailable` flag
2. **Upsert repo records** — match on `(workspaceId, path)`. Update remote URL, branch, dirty state, build system each heartbeat.
3. **Classify & act:**
   - **Green** — already linked, update repo metadata only
   - **Blue** — auto-create `project` with `status: 'active'`, link repository, set `forgeGraphAppId`. Emit activity: "Project auto-created from ForgeGraph app"
   - **Yellow** — store as discovered repo, visible in UI discovery queue
   - **Red** — store as warning entry, no repo record created
4. **Detect removals** — repos in DB not in latest heartbeat marked `stale` (not deleted)

### UI — Projects & Discovery Dashboard

**Active Projects (green):**
- Project name, repo URL, current branch, dirty indicator
- ForgeGraph app status (linked)
- Active work items count, agent availability
- Quick actions: create work item, start agent session, view dispatch history

**Ready to Onboard (blue):**
- Same as green with "onboarding" badge
- Prompt to set project key, assign lead, configure automation

**Discovered Repos (yellow):**
- Repo name, path, remote URL, branch, build system
- "Register with ForgeGraph" button → triggers `forge app create` via gateway
- "Ignore" → dismisses from list
- Registering promotes yellow → blue → auto-creates project

**Warnings (red):**
- Directory name, path
- Dismissable, informational only

**Notices banner (top):**
- "ForgeGraph CLI not detected" or "ForgeGraph not authenticated"
- Dismissable, persisted per-user, links to setup instructions

### End-to-End Workflow

1. **Agent verification** — User opens Bob UI, workspace shows daemon online (green heartbeat). Agent types listed.
2. **Repo discovery** — Projects page shows repos auto-detected from `DEV_DIR`. ForgeGraph-linked repos appear as active projects. New repos in discovery queue.
3. **Onboarding** — User clicks "Register with ForgeGraph" on a yellow repo. Gateway runs `forge app create`. Next heartbeat picks up new app ID. API auto-creates project. Yellow → blue → green.
4. **Creating work** — Navigate to project, create work items. Optionally start planning session to break epics into tasks with dependencies.
5. **Dispatching** — Assign task, dispatch. Gateway spawns agent session in repo worktree. Agent works, events persisted.
6. **Review & PR** — Agent completes, creates artifacts (diff, test report). Work item → `in_review`. User reviews in UI, approves or requests changes.
7. **Merge & deploy** — On approval, ForgeGraph handles build/deploy. Status flows back as activities. Item → `done`.

### Schema Changes

- `repositories` table: add `buildSystem` (text, nullable), `dirty` (boolean), `stale` (boolean)
- `workspaces` table: add `forgeAvailable` (boolean), `forgeApiKey` (text, encrypted, nullable), `devDir` (text, nullable)
- New: `discoveredDirs` table for red (non-git) entries — `id`, `workspaceId`, `path`, `name`, `dismissed`, `lastSeen`
- `projects` table: existing `status` enum may need a `discovered` value, or use the existing `planned` for auto-created

### Gateway Changes

- New `repoScanner` module: walks `DEV_DIR`, classifies repos
- New `forgeDetector` module: checks forge CLI presence, auth status, caches app list
- Heartbeat sender expanded to include scan results
- New endpoint: `POST /forge/register` — triggers `forge app create` for a given path
- Startup: forge detection + initial scan before first heartbeat

### Config

- `DEV_DIR` env var (or `--dev-dir` flag)
- `FORGE_CLI_PATH` env var (default `~/.forgegraph/bin/fg`)
- Forge availability is runtime-detected, not required
