# ForgeGraph Setup on labnuc

**Date:** 2026-04-06
**For:** ForgeGraph team setting up repo onboarding on labnuc

## What's been done

### Bob CLI daemon

The `bob` Go CLI is installed at `~/bob-cli` on labnuc. It runs as a background daemon that:

1. **Scans `/home/mackieg/dev`** for git repositories (58 repos found)
2. **Detects installed agents** — claude, codex, opencode, gemini are all in PATH
3. **Detects ForgeGraph CLI** at `~/.forgegraph/bin/fg` (authenticated)
4. **Sends heartbeats** every 30s to `https://blder.bot/api` with repo + agent data
5. **Polls for queued agent runs** and executes them locally

Daemon management:
```bash
~/bob-cli daemon start /home/mackieg/dev   # start (use: bash -l -c '...' for full PATH)
~/bob-cli daemon stop                       # stop
~/bob-cli daemon status                     # check
tail -f ~/.config/bob/daemon.log            # logs
```

Config at `~/.config/bob/config.yaml`:
```yaml
api_key: bob_d534b80d49063052569e1955889af20bcdfab07bd020d7dd380f05139a7f5362
workspace_id: f22e69dc-9f28-4ec1-9f22-ceb2e0434cb6
dev_dir: /home/mackieg/dev
```

### ForgeGraph CLI

- **Binary:** `~/.forgegraph/bin/fg` (v0.3.1, linux-x64)
- **Authenticated:** credentials at `~/.forgegraph/credentials.json`
- **Server:** https://forgegraf.com
- **3 apps registered:** bob, blder, appealkey

### What's NOT working yet

**Repo-to-app matching returns 0 forge-linked repos.** Two reasons:

1. **Forge apps have no `flakeRef`** — the `fg app list --json` output has no git URL field. Bob's detector matches repos to apps by extracting the git remote URL from each app's `flakeRef` and comparing it to the repo's `origin` remote. Without `flakeRef`, no matches happen.

2. **Git remotes point to old hosts** — repos on labnuc have remotes pointing to `git.gmac.io` or `github.com`, not `gitea.forge.gmac.io`. Even if forge apps had URLs, they might not match.

## What the ForgeGraph team needs to do

### Step 1: Register repos as ForgeGraph apps

For each repo you want managed, run `fg setup` or `fg init` from the repo directory on labnuc. This should create the app in ForgeGraph with the correct git URL / flakeRef.

Priority repos (the active projects):
```
/home/mackieg/dev/bob          — AI agent manager (blder.bot backend)
/home/mackieg/dev/appealkey    — (if it exists as a repo here)
```

### Step 2: Ensure `fg app list --json` includes git URLs

The matching logic in `bob` (at `internal/forge/detector.go`) does:

```go
// For each discovered repo, match against forge apps by git remote URL
flakeRefRe = regexp.MustCompile(`git\+?(https?://[^?#]+)`)
```

It expects each app to have a `flakeRef` field like:
```
git+https://gitea.forge.gmac.io/mackieg/bob.git?ref=main
```

If ForgeGraph uses a different field or format, we need to update the matching logic in:
- **Bob CLI:** `~/dev/bob-cli/internal/forge/detector.go` (MatchAppByRemoteURL)
- **Bob gateway:** `apps/gateway/src/discovery/forge-detector.ts` (findAppByRemoteUrl)

### Step 3: Verify the loop

After registering apps:
```bash
# Restart daemon to pick up changes
~/bob-cli daemon stop
bash -l -c '~/bob-cli daemon start /home/mackieg/dev'

# Check logs — should now show forge-linked repos
tail ~/.config/bob/daemon.log
# Expected: [bob] found 58 repos (N forge-linked, M git-only)
```

Then check the UI at https://blder.bot — the discovery page should show:
- **Green (Linked):** repos matched to forge apps AND with Bob projects
- **Blue (ForgeGraph-ready):** repos matched to forge apps but no Bob project yet (auto-created on next heartbeat)
- **Yellow (Git-only):** repos with no forge app match
- **Red (Not a repo):** directories without `.git`

## Architecture overview

```
labnuc (~/bob-cli daemon)
  |
  |-- scans /home/mackieg/dev every 30s
  |-- detects agents: claude, codex, opencode, gemini
  |-- detects forge: ~/.forgegraph/bin/fg
  |-- matches repos to forge apps by git remote URL
  |
  |-- POST https://blder.bot/api/v1/workspaces/:id/heartbeat
  |     { agentTypes, forgeAvailable, repos: [...] }
  |
  |-- GET https://blder.bot/api/v1/runs?status=queued
  |     (polls for work, executes agent runs locally)
  |
blder.bot (Cloudflare Workers, vinext)
  |
  |-- receives heartbeats, upserts repos
  |-- auto-creates projects for forge-linked repos
  |-- serves discovery UI at /discovery
  |-- dispatches agent runs back to daemon
  |
ForgeGraph (forgegraf.com)
  |
  |-- owns app definitions (repos, CI/CD, deploys)
  |-- Bob queries app list via fg CLI
  |-- work items synced bidirectionally
```

## Ownership model

- **ForgeGraph** owns: app definitions, repositories, credentials, CI/CD, deployments
- **Bob (blder.bot)** owns: work items, agent sessions, threads, planning
- **Bob CLI daemon** is the bridge: discovers repos locally, matches to forge apps, executes agent work

## Future plans

1. **Auto-onboarding** — when a repo matches a forge app, Bob auto-creates a project and links it. User sees it go from yellow → blue → green without intervention.

2. **Register from UI** — the discovery page has a "Register with ForgeGraph" button for yellow (git-only) repos. This calls `fg app create` via the daemon's `/forge/register` endpoint.

3. **Work item → PR flow** — user creates work item in Bob UI, dispatches agent, agent creates branch + PR, ForgeGraph handles CI/CD, status flows back as activities.

4. **Forge app metadata enrichment** — once apps have git URLs, we can show build status, deploy status, and health directly in Bob's project view.

## Key file paths

| What | Where |
|------|-------|
| Bob CLI binary | `~/bob-cli` |
| Bob CLI config | `~/.config/bob/config.yaml` |
| Bob daemon log | `~/.config/bob/daemon.log` |
| Bob daemon PID | `~/.config/bob/daemon.pid` |
| Forge CLI binary | `~/.forgegraph/bin/fg` |
| Forge credentials | `~/.forgegraph/credentials.json` |
| Forge config | `~/.forgegraph/config.yaml` |
| Dev repos | `/home/mackieg/dev/` (58 repos) |
