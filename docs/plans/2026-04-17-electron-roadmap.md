# Electron Desktop Roadmap

Master index for the four-phase build. Each phase has its own plan doc; this page is the overview + gating.

**Design:** [2026-04-16-electron-desktop-design.md](./2026-04-16-electron-desktop-design.md)

---

## Phase 1 — Node server + PGlite

**Plan:** [2026-04-17-electron-phase-1-node-server-plan.md](./2026-04-17-electron-phase-1-node-server-plan.md)

**Ships when:** `BOB_BUILD_TARGET=node BOB_DB_DRIVER=pglite pnpm --filter @bob/blder start` renders the full blder UI on Mac with data persisted to `~/.bob/userdata/db/`.

**Why first:** proves the backend stack works on Node without Workers. Nothing else can start until this is green.

**Scope:**
- PGlite driver in `packages/db` + driver dispatcher via `BOB_DB_DRIVER`
- Migration runner refactored to work against pg or PGlite
- `apps/blder/vite.config.ts` supports `BOB_BUILD_TARGET=node` (Cloudflare plugin off)

**Effort:** ~14 tasks, 1–2 engineer-days.

---

## Phase 2 — Electron shell + bob-server

**Plan:** [2026-04-17-electron-phase-2-shell-plan.md](./2026-04-17-electron-phase-2-shell-plan.md)

**Ships when:** `pnpm --filter @bob/desktop dev` opens an Electron window, renders the blder UI, and the bundled Go `bob` daemon connects to the auto-spawned bob-server.

**Depends on:** Phase 1.

**Scope:**
- `apps/bob-server` (Node HTTP wrapper with CLI flags + auth-token + vinext child process)
- `apps/desktop` (Electron main/preload, subprocess lifecycle, logs)
- Bundled Go daemon binary, eager spawn
- Dev + start scripts for both apps

**Effort:** ~14 tasks, 3–4 engineer-days.

---

## Phase 3 — Connection manager

**Plan:** [2026-04-17-electron-phase-3-connections-plan.md](./2026-04-17-electron-phase-3-connections-plan.md)

**Ships when:** user can switch between `Local`, a `Remote Node server` (URL + auth-token), and `cloud.bob.io` (GitHub OAuth) without restarting the app.

**Depends on:** Phase 2.

**Scope:**
- Connection store (`~/.bob/userdata/connections.json`) + safeStorage-encrypted tokens
- Sidebar UI + add/remove/switch flows
- Health polling + status dots
- GitHub OAuth via loopback redirect (requires cloud.bob.io server-side PKCE endpoints)

**Effort:** ~12 tasks, 3–4 engineer-days + cloud-side OAuth backend work (separate track).

---

## Phase 4 — Distribution

**Plan:** [2026-04-17-electron-phase-4-distribution-plan.md](./2026-04-17-electron-phase-4-distribution-plan.md)

**Ships when:** a fresh Mac can install the signed DMG from GitHub Releases, launch Bob, use it, and receive auto-updates.

**Depends on:** Phase 3.

**Scope:**
- `electron-builder` config → universal DMG (arm64 + x64)
- Developer ID Application signing + notarytool notarization
- `electron-updater` wired to GitHub Releases + in-app update UX
- Release workflow triggered by `desktop-v*` tags
- Branding: icon, DMG background, entitlements

**Effort:** ~10 tasks, 2–3 engineer-days + one-time Apple Developer setup.

---

## Cross-phase dependencies

| Phase | Blocks | Notes |
|---|---|---|
| 1 | 2, 3, 4 | Backend must run on Node first |
| 2 | 3, 4 | Electron shell exists before connection UI |
| 3 | 4 (soft) | Distribution can technically ship with only Local + Remote; cloud OAuth can land later |
| — | — | Each phase refines the *next* phase's plan at its start — the plans for 3 and 4 are deliberately lighter on TDD detail because real learnings in 1 and 2 will shape them |

---

## Strategic context (from design)

- Bob is the root gmacko monorepo base; ooda inherits.
- Long-term, either (a) replace Bob-as-base with a fork of t3code, or (b) Bob + ooda become t3code plugins.
- The Electron shell, `apps/bob-server`, and connection manager are the structural shared layers — keep Bob-specific code (work items, ForgeGraph, agent-run workflows, BRD generation) out of them.
- ooda's specialized workflows (knowledge gathering, RAG corpus) layer on the same chat/planning/thread base as Bob.

If ooda starts implementing its own desktop before we've extracted `packages/desktop-server-core`, extract then — mechanical move, no redesign.

---

## Open cross-phase risks

1. **Workers-specific imports from tRPC routers** (surfaces in Phase 1 smoke). Some routers may call `env` bindings, D1, KV, or other Workers-only APIs. Each hit needs a Node fallback.
2. **cloud.bob.io PKCE backend** (Phase 3). Cloud needs to expose `/oauth/github/start` + `/oauth/exchange`. Parallel track with cloud team.
3. **Hardened runtime + PGlite JIT** (Phase 4). May require entitlement tuning or a non-JIT PGlite build.
4. **Universal DMG size** (Phase 4). Expect 200–300MB. Worth a pass for size reduction after v1.
