# Persisting Connections and Live Terminals Across Instance Switching

## Summary
- Goal: Keep Claude instance terminals alive and streaming while the user switches between worktrees/instances, without needing to reconnect each time.
- Why: Reconnects cause latency, lost scrollback, and wasted CPU/network. Persistent sessions improve responsiveness and developer flow.
- Scope: Backend terminal/WS lifecycle, frontend connection management, buffering, resilience, and UX affordances. No API surface changes required for basic functionality.

## Non‑Goals
- Persisting PTY state across backend restarts (requires process checkpointing; out of scope).
- Multiplexing a single terminal session to multiple users/windows simultaneously (nice to have; optional roadmap).

## Current Behavior (as of repo state)
- Backend
  - `ClaudeService` maintains `IPty` processes per instance in memory; status persisted in SQLite. Instances survive frontend tab/panel switches but not backend restarts.
  - `TerminalService` tracks ephemeral sessions. Each session holds a single `websocket?: WebSocket` and hooks directly to PTY/process streams.
  - WS server (`backend/src/server.ts`) attaches a single client to a session via `sessionId` query.
- Frontend
  - `TerminalPanel` clears local session state when switching instances, then queries `/instances/:id/terminals` and re-creates a session if needed.
  - `TerminalComponent` opens a fresh `WebSocket` per mount and closes it on unmount.
  - A `WebSocketManager` exists but is unused here and points at a hardcoded port.

Consequence: Terminals keep running server-side, but the UI disconnects/reconnects as the user switches, causing visible delays and missing interim output unless rejoined quickly.

## Design Overview
We will keep connections and PTY sessions warm by:
1) Decoupling UI components from the underlying WebSocket lifecycle via a connection manager.
2) Caching terminal output per session in a lightweight ring buffer to replay on reattach.
3) Adding WS heartbeat and graceful reconnect to reduce idle disconnects.
4) Tracking per-instance session IDs so the UI can instantly re-bind when returning.

### Backend
- Keep current PTY-per-instance model. Continue to create 1 Claude PTY per running instance.
- Add lightweight server-side support:
  - Heartbeat: Respond to `{type: "ping"}` with `{type: "pong"}` in `TerminalService.attachWebSocket`.
  - Optional: Ring buffer per session (small, e.g., 2–8KB) storing last N bytes of output to assist UI replay on reconnect. Expose via an initial `{type: "snapshot", data }` after attaching. This is optional if the frontend maintains its own cached buffer while the WS stays open.
  - Optional (later): Allow multiple WS attachments per session (fan-out) by switching `session.websocket` to a `Set<WebSocket>`. Not strictly necessary if a single UI window manages one WS per session.

### Frontend
- Introduce a persistent connection layer (revive and integrate `WebSocketManager`):
  - Connection pool keyed by `sessionId` that stays open across component unmounts.
  - Support subscribe/unsubscribe callbacks. When last subscriber goes away, keep connection open (configurable idle TTL) instead of closing.
  - Heartbeat (ping/pong) handling and exponential backoff reconnect.
- Terminal buffering:
  - Maintain a per-session ring buffer (string or Uint8Array) mirroring data events to allow instant replay into a fresh xterm instance after remount.
  - Limit memory via fixed-size buffers and chunked writes to xterm.
- Session identity and reuse:
  - When an instance first reaches `running`, create (or discover) its Claude terminal session and store `sessionId` in a global map (e.g., React context/store keyed by `instanceId`).
  - On panel/tab switches, do not clear the global session map; `TerminalPanel` should read the cached `sessionId` and immediately render a `TerminalComponent` that binds to the existing connection via the manager and replays buffer.
  - Only close sessions explicitly (user action) or via LRU/TTL policy.
- URL/port unification:
  - Ensure `WebSocketManager` computes the correct WS URL/port for both dev (backend port `43829`) and Electron prod (same port as HTTP server), matching the logic in `Terminal.tsx`.

### Lifecycle Diagram (high-level)
- Start instance -> backend spawns PTY -> UI requests `/instances/:id/terminal` -> returns `sessionId`.
- UI `wsManager.connect(sessionId)` opens WS and begins buffering. `TerminalComponent` subscribes and writes to xterm.
- User switches instance -> `TerminalComponent` unsubscribes, but `wsManager` keeps WS alive and continues buffering.
- User returns -> new `TerminalComponent` subscribes; `wsManager` replays buffer then streams live data.

### Resilience & Resource Management
- Idle policy: keep WS open while app is running; add configurable TTL (e.g., 10–30 min) and LRU cap (e.g., 8–12 sessions). Oldest idle closes first.
- Memory caps: fixed-size ring buffers (e.g., 64–256KB per session). Drop oldest content on overflow.
- Reconnect: exponential backoff up to N attempts; surface a small indicator in UI when background reconnecting; auto-resubscribe listeners.
- Cleanup: on window unload, close connections gracefully.

### Security & Safety
- Validate `sessionId` on the server as today (bound to instance and created internally).
- Keep heartbeat message schema narrow and ignore unknown types.
- Avoid logging full terminal streams.

## Rollout Plan
1) Backend minor changes (ping/pong; optional session buffer API).
2) Frontend integration of `WebSocketManager` with correct URL logic, buffering, and subscription API.
3) Refactor `TerminalPanel` to persist per-instance `sessionId`s in a global store.
4) Replace direct WS usage in `TerminalComponent` with manager subscriptions + buffer replay.
5) Add guardrails: TTL/LRU, settings toggle for “Keep Claude terminals warm”.
6) Manual test and polish.

## Testing Plan
- Backend
  - Unit: ping/pong handler; optional snapshot payload.
  - Manual: verify no crashes when multiple attaches/detaches; confirm instances remain running.
- Frontend
  - Simulate switching between 3+ instances repeatedly; verify no reconnect spinner and output is continuous.
  - Kill/restart backend while UI is open -> observe reconnect behavior and error messages.
  - Memory observation: buffers remain bounded; idle sessions close per policy.

## Open Questions
- Do we want server-side multi-attach fan-out now or later? (Default: later.)
- Desired default TTL and max warm sessions? (Propose TTL=30m, max=8.)
- Should we persist `sessionId` to DB to restore after a full page reload? (Optional; PTY still exists, but session IDs are ephemeral. We can always query existing sessions or create a fresh one.)

## Step-by-Step TODOs

### Backend
- Heartbeat support
  - [ ] In `TerminalService.attachWebSocket`, when receiving `{type: 'ping'}`, respond with `{type: 'pong'}` to the same socket.
  - [ ] Gate unknown message types safely (ignore/log once).
- Optional ring buffer (defer if not immediately needed)
  - [ ] Add small per-session output buffer and emit `{type: 'snapshot', data}` on new attach.
  - [ ] Guard with size limits and tests.

### Frontend
- Connection manager
  - [ ] Update `frontend/src/services/WebSocketManager.ts` to compute WS URL like `Terminal.tsx` (dev: `43829`, Electron prod: same port as HTTP).
  - [ ] Add per-session ring buffer with fixed size; expose `getSnapshot(sessionId)`.
  - [ ] Keep connections open when last subscriber unsubscribes; add configurable idle TTL and LRU cap.
  - [ ] Implement `send(sessionId, data)` with backoff on failure and heartbeat ping timer.
- Terminal component
  - [ ] Replace direct `WebSocket` usage with `wsManager.connect/subscribe`.
  - [ ] On mount: write `wsManager.getSnapshot(sessionId)` to xterm, then stream live data.
  - [ ] On unmount: unsubscribe only; do not close the underlying WS.
  - [ ] Maintain resize handling by sending `resize` via `wsManager.send`.
- Panel/state management
  - [ ] Introduce a lightweight global store (React context or Zustand) mapping `instanceId -> { claudeSessionId, directorySessionId }`.
  - [ ] On first connection per instance, cache `sessionId`; on switch, reuse it instead of clearing.
  - [ ] Update `TerminalPanel` to stop clearing session IDs on instance change; instead, read from the global store and lazy-create only if missing.
- Settings & UX
  - [ ] Add a settings toggle: “Keep Claude terminals warm”.
  - [ ] Add subtle background connection indicator (e.g., green dot in tab label when warm and streaming).

### QA and Observability
- [ ] Manual pass with multiple instances; confirm no reconnect spinners on tab/instance switches.
- [ ] Add debug panel to show `wsManager` connection stats (open/connecting/closed) for troubleshooting (dev-only).
- [ ] Verify memory stays bounded under long sessions (observe ring buffer size). 

## Risks & Mitigations
- Memory growth: use fixed-size ring buffers + connection caps.
- Backend restarts: expect reconnect; expose clear UX and retry guidance.
- Multiple windows: each window has its own manager; acceptable. Consider multi-attach later if needed.

