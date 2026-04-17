# Bob Electron Desktop — Design

**Status:** Approved design, pending implementation plan
**Date:** 2026-04-16
**Reference:** [t3code](/Volumes/dev/t3code/) — we heavily mirror t3code's architecture; long-term we may blend/fork.

**Strategic context:** Bob is the root **gmacko monorepo** base — spanning **desktop, web, and mobile**. `ooda` (/Volumes/dev/ooda) will inherit from Bob. The two products solve different problems on top of the same base:

- **Bob** — building software (agent orchestration, work items, ForgeGraph integration, agent runs)
- **ooda** — exploring ideas, knowledgebases, wikis

Long-term, either (a) replace Bob-as-base with a fork of t3code, or (b) Bob + ooda become t3code plugins sharing components. This design doc scopes the **desktop slice** of the gmacko base (web already exists via `apps/blder`; mobile is a separate track). Bob-specific code is cleanly separated from generic shell plumbing so inheritance (by ooda) or replacement (by a t3code fork) is a clean move later.

## Goal

Ship Bob as a local-first Electron app on macOS (first), while:

- Reusing the existing web UI verbatim (`apps/blder`, vinext/Vite)
- Supporting remote instances — both cloud.bob.io (Workers) and peer Node-server instances on LAN/Tailnet — similar to how the web app currently supports remote agents
- Keeping the Go `bob` CLI/daemon as-is; the same binary ships both in Electron and via Homebrew

## Non-goals (v1)

- Windows/Linux distribution (Mac first; architecture is cross-platform but only Mac builds ship)
- Offline mutation queuing / CRDT sync (local-first means local *data + execution*, not multi-device merge)
- Multi-window / multi-connection-at-once (single active connection; no tabs)
- Folding the Go daemon into the Electron Node process (stays as a sidecar)

## Architecture overview

```
┌─── Electron main (apps/desktop) ────────────────────────┐
│                                                         │
│  ┌─ child: Node server (apps/bob-server) ──────────┐    │
│  │    HTTP + WS on 127.0.0.1:<random>              │    │
│  │    Serves SPA from apps/blder/dist/client       │    │
│  │    Mounts vinext Node SSR handler               │    │
│  │    Drizzle → PGlite at ~/.bob/userdata/db       │    │
│  │    tRPC + WS relay (reuses packages/api, /ws)   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─ child: Go bob daemon (bundled binary) ─────────┐    │
│  │    Eager spawn on app launch                    │    │
│  │    Points at active connection (URL + token)    │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  BrowserWindow → loads http://127.0.0.1:<port> (local)  │
│                 or remote URL with auth-token (remote)  │
└─────────────────────────────────────────────────────────┘
```

### Process tree

- **Electron main** (`apps/desktop/src/main.ts`) — lifecycle, window, native IPC, update machine, child process management
- **`bob-server`** — spawned subprocess, receives auth token via bootstrap-fd (inherited FD, one-shot JSON envelope), binds to `127.0.0.1` on a random free port
- **`bob` daemon** — bundled Go binary in `apps/desktop/resources/bin/bob-<platform>-<arch>`, spawned eagerly, pointed at the active connection

### Connection manager

Named connection list, single active, stored in `~/.bob/userdata/connections.json`:

- **Local** — auto-generated token shared with spawned server
- **Remote Node server** — arbitrary URL + auth-token paste (for LAN/Tailnet peers running `bob-server start --host …`)
- **cloud.bob.io** — GitHub OAuth via loopback redirect (Electron opens default browser → GitHub → `http://127.0.0.1:<ephemeral>/callback`)

Switching connection:

1. Stop/redirect the Go daemon to the new URL+token
2. `BrowserWindow.loadURL` the new server's root
3. If switching to Local and no server is running, spawn it first

### Data layer

**PGlite** (WASM Postgres, ~3MB, in-process) under `~/.bob/userdata/db/`:

- Deliberate divergence from t3code (which uses SQLite) to avoid schema-forking — `packages/db/schema.ts` is pg-specific (JSONB, arrays, uuid types) and already shipped to Neon/Hetzner
- Reuses existing Drizzle migrations verbatim (`drizzle-kit push` on first run)
- Add `packages/db/client-pglite.ts` alongside the existing `client.ts` / `client-neon.ts`
- `packages/db/index.ts` picks a client based on `BOB_DB_DRIVER` env set by `bob-server`

### Auth

| Connection type | Flow |
|---|---|
| Local | Auto-token (64 random bytes); Electron passes to server via bootstrap-fd, to daemon via bootstrap-fd, to SPA via `?t=…` on first load then sessionStorage |
| Remote Node server | User generates a token in the remote host's CLI (`bob-server token print`), pastes into Electron's "Add connection" dialog |
| cloud.bob.io | Loopback-redirect OAuth: open default browser → GitHub → `http://127.0.0.1:<ephemeral>/callback` → Electron captures code → exchanges for session token → stores in macOS Keychain via `safeStorage` |

Deferred: custom `bob://` protocol — loopback is equally good for OAuth and avoids protocol registration in dev/prod builds.

## SPA build target

`apps/blder` already builds to `dist/client` + `dist/server` via vinext. The Cloudflare Vite plugin is currently opt-in (`!isDev` in `vite.config.ts`). We add a `BOB_BUILD_TARGET=node` toggle that disables the Cloudflare plugin so the same vinext output is servable from Node. No UI fork.

## Repo layout additions

Structured so Bob's product-specific code and generic shell plumbing are cleanly separated. When ooda inherits, it reuses the `apps/desktop` shell + `packages/desktop-server-core` and provides its own product config + server entry.

```
apps/
  desktop/                        # Electron shell — PRODUCT-AGNOSTIC
    src/
      main.ts                     # loads ProductConfig at build time
      preload.ts
      updateMachine.ts
      syncShellEnvironment.ts
      rotatingFileSink.ts
      confirmDialog.ts
      productConfig.ts            # imports product config (./product.bob.ts in Bob)
      product.bob.ts              # Bob-specific: name, bundle id, icons, server entry, daemon spec
    resources/
      bin/
        bob-darwin-arm64          # bundled Go daemon
        bob-darwin-x64
    scripts/
      dev-electron.mjs
      start-electron.mjs
      smoke-test.mjs
  bob-server/                     # Bob's server entry — PRODUCT-SPECIFIC
    src/
      bin.ts                      # imports desktop-server-core, registers Bob's routers/handlers
      routers.ts                  # wires packages/api tRPC + packages/ws handlers
packages/
  desktop-server-core/            # NEW — PRODUCT-AGNOSTIC
    src/
      cli.ts                      # --mode / --port / --host / --auth-token / --bootstrap-fd / --no-browser
      http.ts                     # HTTP server, static asset serving, SSR handler mount
      ws.ts                       # WS upgrade + auth-token verification
      bootstrap.ts                # bootstrap-fd envelope
      serverKit.ts                # createServer({ routers, wsHandlers, staticDir, ssrHandler }) → bin-ready
  db/
    src/
      client-pglite.ts            # NEW
      client.ts                   # unchanged (prod pg)
      client-neon.ts              # unchanged
```

### Product-agnostic vs product-specific split

| Generic (reusable by ooda / t3code fork) | Bob-specific |
|---|---|
| `apps/desktop` (except `product.bob.ts`) | `apps/desktop/src/product.bob.ts` |
| `packages/desktop-server-core` | `apps/bob-server` |
| `packages/db` driver layer | `packages/db/schema.ts` (Bob's schema) |
| Connection manager UI primitives | Work item UI, ForgeGraph UI, agent run UI |
| **Chat / threads / messages UI + backend** | Bob's thread *bindings* (what a thread attaches to: work item vs ooda's wiki article / paper) |
| **Planning sessions UI + backend** (`packages/api/src/router/planSession.ts`, split-view planning route) | Bob-specific outputs of a plan (work items, ForgeGraph wiring) |
| `electron-builder` config template | Bob branding, icons, bundle id |

**ooda parallel context:** ooda's domain is research threads generating wiki articles and academic-paper sourcing — different nouns, same verbs. The chat/planning/thread workflows Bob has today are *shared infrastructure*. Bob attaches threads to work items; ooda attaches them to wiki articles. Keep the thread/session/message layer noun-agnostic; Bob- or ooda-specific "bindings" layer on top.

### Specialized workflows (stay in the product layer)

- **Bob**: BRD generation with requirements, tasks with acceptance criteria + required tests, PR integration, monitoring hooks — the full software-building lifecycle downstream of a planning thread.
- **ooda**: knowledge gathering (research threads, paper sourcing), digestion into a "poor man's RAG" / wiki corpus.

Both compose on top of the shared chat/planning base but never leak into it. A change to BRD templates must not touch the thread/session schema.

### ProductConfig interface (sketch)

```ts
export type ProductConfig = {
  id: string;                  // "bob" | "ooda"
  displayName: string;         // "Bob" | "ooda"
  bundleId: string;            // "bot.blder.desktop"
  userDataDirName: string;     // "bob" → ~/.bob/userdata/
  serverBinPath: string;       // path to apps/bob-server/dist/bin.js
  daemon: {
    binPath: string;           // path to bundled Go daemon
    spawnArgs: (ctx: { url: string; token: string }) => string[];
  };
  ssrEntry: string;            // apps/blder/dist/server/index.js
  staticDir: string;           // apps/blder/dist/client
};
```

## Phasing

### Phase 1 — Node server (no Electron)

- `apps/bob-server` scaffolded with CLI flags `--mode / --port / --host / --auth-token / --bootstrap-fd / --no-browser`
- Serve `apps/blder/dist/client` as static + mount vinext SSR handler
- Mount `packages/api` tRPC routes + `packages/ws` WS endpoints
- PGlite driver in `packages/db` + auto-migrate on first run
- Gate: `bun run --cwd apps/bob-server start --port 3773` on Mac renders the full blder UI end-to-end with data persisted locally

### Phase 2 — Electron shell

- Copy t3code's `apps/desktop` structure; adapt branding
- Bundle id `bot.blder.desktop`, productName `Bob`
- Spawn `bob-server` as subprocess (random port, bootstrap-fd token)
- Spawn bundled Go `bob` daemon eagerly
- `BrowserWindow` loads `http://127.0.0.1:<port>/?t=<token>`
- Gate: `bun run --cwd apps/desktop dev` opens a window with working blder UI, local PGlite data, Go daemon running

### Phase 3 — Connection manager

- Connections sidebar/menu in the UI (new component in `packages/ui` or app shell)
- Add Remote Node server (URL + token)
- Add cloud.bob.io (loopback OAuth, Keychain storage)
- Switch connection = stop/redirect daemon + reload window
- Gate: switch between Local, a Tailnet peer running `bob-server`, and cloud.bob.io without restart

### Phase 4 — Distribution

- `electron-builder` config, universal DMG (arm64 + x64)
- Developer ID Application signing + notarytool notarization
- `electron-updater` wired to GitHub Releases on a dedicated repo (or a `desktop/` release channel)
- Smoke test: clean Mac → install DMG → launch → creates a workspace → runs an agent → collects artifact

## Open questions (for implementation plan)

- Do we ship a built-in "Remote Node server" mode discovery (mDNS/Tailnet auto-listing) or keep it strictly URL-paste for v1? *(Lean: URL-paste only.)*
- Daemon bootstrap-fd: Go binary doesn't currently read FD envelopes. Either add that, or pass token via env var at spawn time with careful scope. *(Lean: env var at spawn, since the daemon is a child of Electron and has no shared process tree with the user's shell.)*
- How does `bob-server start --host 0.0.0.0` from Electron's bundled copy interact with the Homebrew-installed `bob-server` (if we ever ship one for LAN hosts)? *(Out of scope for v1 — Homebrew `bob` daemon only, not `bob-server`.)*

## Future direction

If Bob blends into t3code:

- `bob-server` becomes a sidecar t3code spawns (t3code owns chat UI + persistence; Bob owns work items + ForgeGraph integration + agent runs)
- UI components live in shared packages consumable by both
- Connection manager pattern transfers 1:1

This design keeps that door open — packages stay modular, nothing here forces a long-term independent codebase.
