# Electron Phase 3 — Connection Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the Electron app switch between three backend connections without restart: `Local` (spawned bob-server), `Remote Node server` (URL + auth-token paste for LAN/Tailnet peers), and `cloud.bob.io` (GitHub OAuth via loopback redirect). Single active connection, named list, minimal UI.

**Architecture:** Connection store lives at `~/.bob/userdata/connections.json` (plain JSON, single active). Electron main owns the store and exposes it to the renderer via IPC. Switching a connection stops/redirects the Go daemon, tears down the current BrowserWindow URL, and loads the new server. GitHub OAuth is handled entirely in Electron main via an ephemeral HTTP listener on a random 127.0.0.1 port.

**Tech Stack:** Electron `safeStorage` (Keychain-backed), `node:http` ephemeral server for OAuth callback, IPC channels (`bob:connections:*`).

**Depends on:** Phase 2 shipped (Electron shell spawns bob-server + daemon).

**Reference:** `/Volumes/dev/t3code/REMOTE.md` for the remote-server posture; t3code's auth-token flow is the model for "Remote Node server".

**Scope:**
- Connection store + IPC
- UI: connection sidebar / menu, add-connection dialog
- "Remote Node server" add-flow (URL + token paste, persisted token encrypted with safeStorage)
- "cloud.bob.io" add-flow (loopback OAuth → session token → Keychain)
- Switching logic: update active, redirect daemon, reload window
- Local connection auto-seeded on first launch

**Out of scope:**
- Multi-window / tabs (single active window stays)
- Discovery (mDNS / Tailnet auto-listing) — URL paste only
- Multi-account GitHub (one cloud connection at a time)
- Connection permissions / per-connection user roles
- Windows/Linux distribution

---

## Prerequisites

1. Phase 2 done-criteria checked
2. GitHub OAuth App created at `https://github.com/organizations/<org>/settings/applications`:
   - Homepage URL: `https://cloud.bob.io` (or wherever the cloud product lives)
   - Authorization callback URL: `http://127.0.0.1/callback` (Electron listens on a random port; GitHub accepts `127.0.0.1` with any port in the callback URL at OAuth-App level)
   - Client ID + Secret provisioned and stored server-side on cloud.bob.io (Electron never sees the secret — PKCE flow)

---

## Task 1: Define the connection store schema + types

**Files:**
- Create: `apps/desktop/src/connections/types.ts`

```typescript
export type LocalConnection = {
  id: "local";
  kind: "local";
  displayName: "Local";
};

export type RemoteConnection = {
  id: string;                 // uuid
  kind: "remote";
  displayName: string;        // "labnuc.tailnet"
  url: string;                // "http://labnuc.tail1e1a32.ts.net:3773"
  encryptedToken: string;     // base64 of safeStorage-encrypted bytes
};

export type CloudConnection = {
  id: "cloud";
  kind: "cloud";
  displayName: "cloud.bob.io";
  url: string;                // "https://cloud.bob.io"
  encryptedToken: string;
  user: { id: string; login: string; avatarUrl?: string };
};

export type Connection = LocalConnection | RemoteConnection | CloudConnection;

export type ConnectionsFile = {
  version: 1;
  activeId: string;
  connections: Connection[];
};
```

Commit: `feat(desktop): connection schema types`

---

## Task 2: Connection store with safeStorage encryption (test first)

**Files:**
- Create: `apps/desktop/src/connections/store.test.ts`
- Create: `apps/desktop/src/connections/store.ts`

**Behavior:**
- `loadConnections(basePath)` → `ConnectionsFile` (or default if missing)
- `saveConnections(basePath, file)` → writes atomically via temp + rename
- `encryptToken(plain)` / `decryptToken(encrypted)` wrappers around Electron `safeStorage`
- Fallback: if safeStorage is unavailable (CI, Linux without gnome-keyring), fall back to plaintext + warn

Tests:
- Round-trip save → load
- Default file structure when missing
- Encrypt-decrypt round-trip
- Corrupted file throws a named error

Commit: `feat(desktop): connection store with safeStorage`

---

## Task 3: IPC channels for connection management

**Files:**
- Create: `apps/desktop/src/connections/ipc.ts`
- Modify: `apps/desktop/src/main.ts` (register handlers)
- Modify: `apps/desktop/src/preload.ts` (expose `window.bob.connections`)

**Channels:**
- `bob:connections:list` → returns `Connection[]` with `isActive` flag; **tokens never cross IPC**
- `bob:connections:add-remote` → takes `{ displayName, url, token }`, validates URL, encrypts token, saves
- `bob:connections:add-cloud` → kicks off OAuth flow (Task 8), returns resulting connection
- `bob:connections:remove` → deletes by id (except `local`, which is undeletable)
- `bob:connections:set-active` → switches active connection (Task 10)
- `bob:connections:test` → pings a given connection's `/health` with its token to verify reachability

Each handler has a unit test that mocks the store and verifies channel name + payload shape.

Commit: `feat(desktop): connection IPC surface`

---

## Task 4: Auto-seed local connection on first launch

**Files:**
- Modify: `apps/desktop/src/main.ts`

On `app.whenReady()`, if `connections.json` is missing, write the default:

```typescript
{
  version: 1,
  activeId: "local",
  connections: [{ id: "local", kind: "local", displayName: "Local" }],
}
```

The local connection has no URL or token persisted — its values are computed at spawn time (random port + generated token).

Test: delete `~/.bob/userdata/connections.json`, launch Electron, file is created with local seed.

Commit: `feat(desktop): auto-seed local connection`

---

## Task 5: Connection sidebar UI in blder

**Files:**
- Create: `apps/blder/src/components/connection-bar.tsx` (adapt to actual component location conventions)
- Modify: `apps/blder/src/app/layout.tsx` (mount the bar)

**UI spec:**
- Top-bar or sidebar element showing active connection's `displayName` + status dot (green/yellow/red based on last health check)
- Click opens a dropdown: list of connections with "Switch" action per row, plus "Add connection" + "Remove" actions
- "Add connection" opens a modal with tabs: "Remote server" (URL + token fields) and "cloud.bob.io" (big "Sign in with GitHub" button)

**IPC usage:**
- On mount, call `window.bob.connections.list()` to populate
- On switch, call `window.bob.connections.setActive(id)` — the window will reload via main-process side effect
- On add-remote, call `window.bob.connections.addRemote({ ... })`
- On add-cloud, call `window.bob.connections.addCloud()` — main handles OAuth

This task is UI-only — no backend changes. If the IPC surface isn't exposed yet, stub the UI against fake data and wire up after Task 3.

Commit: `feat(blder): connection sidebar UI`

---

## Task 6: Connection health polling

**Files:**
- Create: `apps/desktop/src/connections/health.ts`
- Modify: `apps/desktop/src/main.ts` (start the poller on ready)

**Behavior:**
- Every 15s, ping each connection's `/health` with its token (or generated local token for local)
- Cache results in-memory; expose via `bob:connections:health-state` IPC for the sidebar status dot
- Timeout: 3s per connection; non-reachable → red dot; reachable but non-200 → yellow; 200 → green

Test: mock http → expected dot state for each status/timeout case.

Commit: `feat(desktop): connection health polling`

---

## Task 7: Add-remote connection flow

**Files:**
- Modify: `apps/desktop/src/connections/ipc.ts` (fill in `add-remote` handler)

**Behavior:**
- Validate URL parses + uses http/https (reject file://, etc.)
- Before persisting, call `testConnection(url, token)` — hit `/health` with `Authorization: Bearer <token>`
- On success: generate UUID, encrypt token, save, return connection summary
- On failure: return a typed error so UI can show "couldn't reach server" / "token rejected"

Tests: mock fetch, verify happy path + each failure mode.

Commit: `feat(desktop): add-remote connection flow`

---

## Task 8: GitHub OAuth loopback flow for cloud.bob.io

**Files:**
- Create: `apps/desktop/src/connections/oauth.ts`
- Create: `apps/desktop/src/connections/oauth.test.ts`

**Flow:**
1. Electron main generates a PKCE code_verifier + code_challenge
2. Starts an ephemeral HTTP server on `127.0.0.1:<random>` with a `/callback` handler
3. Opens the user's default browser to:
   `https://cloud.bob.io/oauth/github/start?state=<random>&code_challenge=<challenge>&redirect_port=<port>`
4. cloud.bob.io handles the GitHub OAuth dance (it has the GH App secret). On success, it 302s back to `http://127.0.0.1:<port>/callback?code=<cloud-issued-code>&state=<random>`
5. Electron captures `code`, POSTs to `https://cloud.bob.io/oauth/exchange` with `{ code, code_verifier }`, receives `{ session_token, user }`
6. Ephemeral server shuts down
7. Persist as a `CloudConnection` with encrypted `session_token`

**Server-side dependency:** cloud.bob.io must expose `/oauth/github/start` and `/oauth/exchange` endpoints with PKCE. This is a separate backend task (not part of this plan) — flag in risks.

**Tests:**
- Mock cloud.bob.io → verify the flow completes end-to-end
- Timeout handling: if user closes browser without completing, Electron's ephemeral server times out after 5 minutes

Commit: `feat(desktop): cloud.bob.io loopback OAuth`

---

## Task 9: Remove connection flow

**Files:**
- Modify: `apps/desktop/src/connections/ipc.ts`

**Behavior:**
- Cannot remove `local`
- If removing the active connection, switch to `local` first
- Scrub encrypted token from disk

Test: remove flow against in-memory store.

Commit: `feat(desktop): remove connection`

---

## Task 10: Switching active connection

**Files:**
- Create: `apps/desktop/src/connections/switcher.ts`
- Modify: `apps/desktop/src/main.ts`

**Behavior on `setActive(id)`:**
1. Verify connection reachable (health check with timeout); fail fast on unreachable
2. Kill the Go `bob` daemon
3. Respawn the daemon with the new connection's URL + decrypted token
4. For `local`: reuse the already-running bob-server (don't respawn)
5. For `remote`/`cloud`: don't spawn a local bob-server (it stays running in the background for a quick switch back, but the BrowserWindow doesn't use it)
6. `win.loadURL(<newUrl>/?t=<token>)`
7. Save `activeId` to store

**Edge cases:**
- Rapid successive switches: serialize via a mutex so we don't end up with two daemons
- BrowserWindow reload failure → pop a dialog "couldn't switch; reverting to previous", revert active

Test: integration-ish test that drives setActive against a fake http server and asserts daemon args changed.

Commit: `feat(desktop): connection switching with daemon redirect`

---

## Task 11: Window reload UX

**Files:**
- Modify: `apps/desktop/src/main.ts`

**Behavior:**
- Show a loading indicator during switch (overlay the BrowserWindow or use `webContents.loadURL` with a grace period)
- If switch takes >5s, show "still switching…" message
- Preserve window size/position; don't relaunch the app

Manual verification: switch Local → Tailnet peer → back to Local. No flicker, no lost window state.

Commit: `feat(desktop): switch-connection loading UX`

---

## Task 12: Phase 3 end-to-end smoke

**Manual steps:**
1. Fresh launch: only `Local` connection exists; UI renders against local PGlite
2. Add a Remote Node server: set up `bob-server start --host 0.0.0.0 --auth-token test` on labnuc or another peer, paste URL + token. Switch. UI renders against remote data.
3. Add cloud.bob.io: click "Sign in with GitHub", complete OAuth, switch. UI renders against cloud data. Verify user avatar shows.
4. Rapid-switch Local ↔ Remote ↔ Cloud three times — no zombies, no crashes.
5. Quit Electron. Reopen. Active connection + both added connections persist.

```bash
git commit --allow-empty -m "feat(desktop): Phase 3 end-to-end smoke passes"
```

---

## Done criteria

- [ ] Connection store + IPC + tests
- [ ] Auto-seed local on first launch
- [ ] Sidebar UI wired
- [ ] Health polling with status dots
- [ ] Add / remove / switch for all three connection kinds
- [ ] GitHub OAuth loopback flow works end-to-end
- [ ] Manual smoke: three-way switching without restart

---

## Risks

1. **cloud.bob.io server-side OAuth endpoints** (Task 8) — requires backend work on cloud.bob.io to expose PKCE start/exchange. If not ready, Phase 3 can ship with only `Local` + `Remote Node server` and cloud-auth deferred.
2. **safeStorage on fresh macOS** — first call may prompt for Keychain access. Document this in local-dev.md.
3. **Daemon restart lag** — Go daemon startup is ~500ms. If switching feels slow, add a fast-path where daemon signals itself to re-read config without restart (out of scope for v1).
4. **BrowserWindow session isolation** — when switching from cloud → local, cookies/localStorage from cloud may leak into local's IndexedDB. Mitigate with `session.fromPartition("persist:<connectionId>")` per connection; verify before calling this done.
