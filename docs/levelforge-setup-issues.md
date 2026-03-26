# LevelForge Setup Issues in Bob

**Date:** 2026-03-25
**Reporter:** Claude Code (automated setup attempt)
**Project:** LevelForge (key: LF, project ID: 3bd98932-9fc8-4a4f-bdb4-092afdf63f84)

---

## What Was Done

1. Created LevelForge project in Bob (key: LF)
2. Created Sprint 1 epic (LF-1: Foundation Wiring)
3. Attempted "Shape this idea with Bob" planning session
4. Session shows "provisioning (connecting...)" then "Disconnected - reconnecting..."

## Issues Found

### Issue 1: Shaping Session Fails to Connect

**Symptom:** Clicking "Open shaping session" on LF-1 shows "provisioning (connecting...)" followed by "Disconnected - reconnecting..." indefinitely. The agent never starts.

**Likely cause:** The LevelForge repository is not cloned on the Bob execution host. The agent needs a local copy of the repo to work against. Bob's System page says "Add repositories with the Add Repository action to get started" but the Add Repository action is not visible.

**Fix needed:**
1. Clone `https://git.gmac.io/gmackie/levelforge.git` on the Bob host machine
2. Register the local path in Bob's repository/worktree system
3. Verify Claude agent is authenticated (System page shows "Installed" but auth status unclear)

### Issue 2: Duplicate LevelForge Projects

**Symptom:** Two identical "LevelForge" projects appear in the project list (both with key "LF"). This happened because the first "Create" click appeared to fail (project didn't show in sidebar) so we created it again.

**Fix needed:** Delete the duplicate project via Bob's admin/API.

### Issue 3: "Add Repository" Not Visible

**Symptom:** The System page mentions "Add repositories with the Add Repository action" but there's no visible button for this. The text appears in a message area that says "Select a worktree — Pick one from the left panel to continue."

**Likely cause:** The repository management UI may not be fully wired yet, or it requires a different navigation path.

**What's needed:** A way to register `git.gmac.io/gmackie/levelforge` as a managed repository in Bob's system so that agent sessions can work against it.

### Issue 4: Claude Agent Auth Unclear

**Symptom:** System Status page shows Claude as "Installed" but the Auth column shows "-" (dash). Other agents (Cursor, Codex, Kiro, OpenCode, Smol) show "Missing".

**Fix needed:** Verify Claude Code is properly authenticated on the Bob host. The agent needs a valid API key or Anthropic session to function.

## Configuration Needed

For Bob to orchestrate LevelForge development:

```
1. Bob host: Clone levelforge repo
   git clone https://git.gmac.io/gmackie/levelforge.git /path/to/levelforge

2. Bob: Register repo path
   (needs Admin/System UI or API call)

3. Bob host: Verify Claude auth
   claude --version  # should show authenticated

4. Bob host: Set environment variables for agents
   GEMINI_API_KEY=<key>
   DATABASE_URL=postgresql://levelforge:levelforge@localhost:5432/levelforge_test

5. Bob: Delete duplicate LF project
```

## What's Ready (No Issues)

- Gitea integration is connected (Settings > Git Providers > Gitea shows "Disconnect")
- API keys exist (2 keys visible in Settings > API Keys)
- Git, Node.js, pnpm all OK on the host
- CI workflow pushed to LevelForge repo (.gitea/workflows/ci.yml)
- Master implementation roadmap committed (76 tasks, 8 sprints)
- Bob orchestration plan committed

## LevelForge Context for Bob Team

Repo: `git.gmac.io/gmackie/levelforge`
Branch: `main`
Tests: `pnpm test` (126 passing in generator, 25 in validators, 20 in catalog, 14 in benchmarks)
Build: `nix build .#levelforge --option sandbox false`
Deploy: `https://level.gmac.io` (live)

Sprint 1 tasks (14 items) are documented in:
`docs/plans/2026-03-25-master-implementation-roadmap.md`

---

## Update: 2026-03-25 7:35 PM

Re-tested after user reported issues resolved. Same behavior:
- Shaping session still shows "provisioning (connecting...)" → "Disconnected - reconnecting..."
- System Status: Claude = Installed, Auth = "-" (NOT AUTHENTICATED)
- "Add repositories" message still shows — repo not registered

### Root Cause
Two issues remain:
1. **Claude agent not authenticated** — Auth column shows "-". Need to run `claude login` or set API key on the Bob host.
2. **No repositories registered** — The "Add Repository" action needs to be used but isn't visible as a button. May need to clone the repo and add it via CLI/API.

### To Fix
On the Bob host machine:
```bash
# 1. Authenticate Claude
claude login  # or set ANTHROPIC_API_KEY

# 2. Clone and register LevelForge repo
git clone https://git.gmac.io/gmackie/levelforge.git /home/bob/repos/levelforge
# Then register via Bob's API or admin interface
```

---

## Update: 2026-03-25 7:52 PM — Still Blocked

Third attempt after user reported "should be working now." Same result:
- Session: "provisioning (connecting...)" → "Disconnected - reconnecting..."
- System Status unchanged: Claude Auth = "-", no repos registered

### Definitive Blockers (must be fixed on Bob host)

1. **Claude Auth = "-"**: The Claude Code CLI is installed but not authenticated.
   On the Bob host, run: `claude login` or ensure `ANTHROPIC_API_KEY` is set.

2. **No repositories in worktree panel**: The left panel on System page says
   "Select a worktree — Pick one from the left panel to continue. Add
   repositories with the Add Repository action to get started."
   No repos are visible. The LevelForge repo needs to be cloned and registered.

### What We Tried
- Created project LF in Bob
- Created epic LF-1 (Sprint 1: Foundation Wiring)
- Attempted shaping session 3 times
- Attached parent work item + README + planning docs context
- Each time: session opens but agent never connects

### Recommendation
Fix Claude auth and repo registration on the Bob host, then retry.
In the meantime, LevelForge Sprint 1 can be executed manually using
Claude Code subagent-driven development (which has been working well
throughout this session).

---

## Update: 2026-03-25 8:10 PM — Gateway Cascade Fix Deployed, Still Not Connecting

Bob team confirmed:
- Claude auth is working (loggedIn: true)
- LevelForge repo registered at /home/mackieg/levelforge
- Duplicate project deleted
- Gateway cascade fallback (smol-agent → claude → codex → gemini) deployed
- Stale smol-agent issue was the original blocker

Current state: Session opens, shows "provisioning (connecting...)" but never
transitions to "connected." After 90+ seconds, stays at "Disconnected - reconnecting..."

### Likely Remaining Issue
The gateway may be spawning the Claude agent process but the PTY/WebSocket
stream between the agent and the browser isn't establishing. Check:
- `journalctl -u bob-gateway` on labnuc for spawn/connection errors
- Whether the Claude process actually starts: `ps aux | grep claude`
- WebSocket connection in browser DevTools (Network tab, WS filter)

### LevelForge Setup Is Complete
- Project: LF (3bd98932)
- Epic: LF-1 (Sprint 1: Foundation Wiring)
- Repo: /home/mackieg/levelforge (registered)
- Auth: Claude authenticated
- CI: .gitea/workflows/ci.yml deployed

Only the PTY session connection is broken. Everything else is ready.

---

## Update: 2026-03-25 9:31 PM — ALL ISSUES RESOLVED

### Root Causes Found and Fixed

1. **Tailscale serve misconfiguration** — Port 8443 was routing to localhost:3003 instead of localhost:3002 (the actual gateway port). This caused the WebSocket to never connect, producing the "Disconnected - reconnecting..." loop.
   - **Fix:** `tailscale serve --https 8443 http://localhost:3002`

2. **smol-agent not installed on labnuc** — The gateway tried to spawn smol-agent which doesn't exist on the host.
   - **Fix:** Added cascade agent fallback in AgentProcessManager: smol-agent → claude → codex → gemini. Falls back automatically on ENOENT.

3. **Auth INVALID_ORIGIN error** — `NEXT_PUBLIC_SITE_URL` had stale `:9443` port baked into the Next.js build from old Caddy setup.
   - **Fix:** Changed auth config to prioritize `FRONTEND_URL` (server-side env var) over `NEXT_PUBLIC_SITE_URL` (build-time var).

4. **Working directory defaulting to "/"** — Planning sessions didn't resolve the repo path from the project's mapped repository.
   - **Fix:** `planSession.create` now looks up the repository path from `repositories.planningProjectId`.

### Current State: WORKING
- Session connects ✅ (green "Running" dot, WebSocket connected)
- Agent starts ✅ (cascade fallback to Claude works)
- Chat UI functional ✅ (messages display, input ready)
- Claude hit usage limit — normal, resets Mar 26 10pm PT
