# Legacy -> Next.js Hosted Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Bob to `claude.gmac.io` with Next.js as the web app + HTTP API surface, while keeping stateful/streaming terminal functionality in a separate long-running backend service suitable for hosted environments.

**Architecture:** Next.js (App Router) owns UI + stateless HTTP endpoints. A dedicated long-running backend service (Node/Express + WebSocket + node-pty) owns terminals, streaming, process lifecycle, and other long-lived operations. Next proxies/bridges requests to the backend service and serves a stable API surface to clients (web + mobile).

**Tech Stack:** Next.js App Router, Node.js service (existing `backend/`), WebSocket, node-pty, pnpm workspaces, ngrok (dev), deployment via SSH to `root@claude.gmac.io`.

## Non-Goals

- Migrating node-pty/WebSocket/terminal streaming into Next route handlers.
- Adding new features unrelated to migration.

## Success Criteria

- All client-facing endpoints used by the Next UI and Expo app work against the hosted domain `https://claude.gmac.io`.
- `/api/config` returns JSON (not HTML) and no client JSON.parse errors occur.
- Terminal streaming and instance lifecycle work in hosted deployment via the backend service.
- No clients reference `localhost:43829` in production.

## Risks / Constraints

- Next route handlers are not suitable for long-lived WebSocket/node-pty workloads in many hosted setups.
- CORS and cookie/session behavior changes between localhost/ngrok/hosted.
- Mixed legacy and Next endpoints can cause ambiguity; we must enforce a single public API surface.

---

## Phase 0: Inventory and Decision Points

### Task 0.1: Enumerate legacy API routes currently used

**Files:**

- Read: `backend/src/server.ts`
- Read: `apps/nextjs/src/lib/legacy/config.ts`
- Read: `apps/expo/**` (API base usage)
- Read: `frontend/src/config/app.config.ts` (legacy Vite app)

**Step 1: Write a failing verification script (no production code)**

Create: `apps/nextjs/scripts/verify-api-surface.mjs`

```js
// verify-api-surface.mjs
// A small script that hits the list of required endpoints and prints status + content-type.
// It should exit non-zero if any required endpoint is missing.
```

**Step 2: Run it to verify it fails (expected, because inventory not complete)**

Run: `node apps/nextjs/scripts/verify-api-surface.mjs`
Expected: FAIL with missing endpoint list.

**Step 3: Populate endpoint list and rerun until script reflects reality**

Run: `node apps/nextjs/scripts/verify-api-surface.mjs`
Expected: PASS once list matches current state (may still show 404s; that is fine for inventory).

**Step 4: Commit**

Commit: `chore: add api surface verification script`

---

## Phase 1: Establish “Public API Surface” (Next owns /api)

### Task 1.1: Define public endpoints and implement stubs in Next

**Files:**

- Create: `apps/nextjs/src/app/api/config/route.ts` (already created)
- Create/Modify: `apps/nextjs/src/app/api/health/route.ts` (verify it matches expectations)
- Create: `apps/nextjs/src/app/api/system-status/route.ts` (proxy)

**Step 1: Write failing Playwright API tests**

Create: `apps/nextjs/e2e/specs/api-config.spec.ts`

```ts
import { expect, test } from "@playwright/test";

test("/api/config returns JSON with required fields", async ({ request }) => {
  const res = await request.get("/api/config");
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json).toHaveProperty("appName");
  expect(json).toHaveProperty("enableGithubAuth");
  expect(json).toHaveProperty("jeffMode");
  expect(json).toHaveProperty("allowedAgents");
});
```

**Step 2: Verify RED**

Run: `pnpm -F @bob/nextjs test:e2e --project=chromium --grep "api/config"`
Expected: FAIL if route missing or returns non-JSON.

**Step 3: Minimal implementation**

Implement/adjust: `apps/nextjs/src/app/api/config/route.ts` to match the schema.

**Step 4: Verify GREEN**

Run: `pnpm -F @bob/nextjs test:e2e --project=chromium --grep "api/config"`
Expected: PASS.

**Step 5: Commit**

Commit: `test: add regression coverage for /api/config`

---

## Phase 2: Proxy Layer (Next -> Backend Service)

### Task 2.1: Define backend service base URL for hosted deployments

**Files:**

- Create: `apps/nextjs/src/server/backendBase.ts`
- Modify: `apps/nextjs/.env.example` (document new env vars)

**Design:**

- `BACKEND_INTERNAL_URL` (e.g. `http://127.0.0.1:43829`) for server-to-server calls.
- `NEXT_PUBLIC_API_BASE` remains empty for browser (same-origin) in hosted.

**Step 1: Write failing unit test for base URL selection**

Create: `apps/nextjs/src/server/backendBase.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { getBackendBase } from "./backendBase";

describe("getBackendBase", () => {
  it("prefers BACKEND_INTERNAL_URL when set", () => {
    process.env.BACKEND_INTERNAL_URL = "http://127.0.0.1:43829";
    expect(getBackendBase()).toBe("http://127.0.0.1:43829");
  });
});
```

**Step 2: Verify RED**

Run: `pnpm -F @bob/nextjs test`
Expected: FAIL (module missing / no vitest config).

**Step 3: Decide test framework**

If `@bob/nextjs` does not have unit tests configured, skip Vitest and use Playwright API tests only. Avoid adding new dependencies unless needed.

**Step 4: Implement**

Create `getBackendBase()` with a simple env-var read.

**Step 5: Commit**

Commit: `chore: add backend base url resolver`

---

### Task 2.2: Implement a generic proxy helper for JSON endpoints

**Files:**

- Create: `apps/nextjs/src/server/proxyJson.ts`

**Behavior:**

- Forwards method, path, query string.
- Forwards `authorization` header if present.
- Returns upstream status + JSON body.

**Testing:**

- Add Playwright test that mocks upstream? If mocking is hard, do minimal integration via local backend dev.

**Commit:** `feat: add json proxy helper`

---

## Phase 3: Migrate Endpoint Groups (Next routes proxy to backend)

### Task 3.1: /api/repositories parity

**Files:**

- Create: `apps/nextjs/src/app/api/repositories/route.ts` (proxy)
- Create: `apps/nextjs/src/app/api/repositories/[id]/route.ts` (proxy)

**Steps (TDD with Playwright API tests):**

- Add tests asserting non-404 response shapes when backend is running.
- Implement proxy routes.
- Verify locally.

**Commit:** `feat: proxy repositories api via next`

---

### Task 3.2: /api/instances parity

**Files:**

- Create: `apps/nextjs/src/app/api/instances/route.ts`
- Create: `apps/nextjs/src/app/api/instances/[id]/*` route(s)

**Commit:** `feat: proxy instances api via next`

---

### Task 3.3: /api/system-status and /api/agents parity

**Files:**

- Create: `apps/nextjs/src/app/api/system-status/route.ts`
- Create: `apps/nextjs/src/app/api/agents/route.ts`

**Commit:** `feat: proxy system-status and agents api via next`

---

## Phase 4: Terminals / WebSocket Strategy (Hosted)

### Task 4.1: Keep backend WebSocket as-is; make Next advertise correct WS URL

**Files:**

- Modify: `apps/nextjs/src/lib/legacy/config.ts` (or new config) to compute WS base from hosted domain or env.
- Modify: `frontend/src/services/WebSocketManager.ts` if still used in hosted Next UI.

**Design options:**

- Option A (recommended): `NEXT_PUBLIC_WS_BASE=wss://claude.gmac.io` and Next reverse-proxies `/ws` to backend.
- Option B: separate subdomain `wss://api.claude.gmac.io` for backend WS.

**Commit:** `feat: hosted websocket base configuration`

---

## Phase 5: Deprecate /api/legacy

### Task 5.1: Replace callers to use new endpoints

**Files:**

- Modify: `apps/nextjs/src/**` callers to hit `/api/*` not `/api/legacy/*`
- Modify: `apps/expo/**` to use hosted origin

**Commit:** `refactor: migrate callers off /api/legacy`

---

## Phase 6: Deployment Plan (SSH)

### Task 6.1: Define deployment unit(s)

**Backend service:** long-running process (systemd) exposing local port (e.g. 43829) bound to loopback.
**Next app:** runs on port (e.g. 3000) behind nginx (or equivalent) serving `claude.gmac.io`.

**Config:**

- `BACKEND_INTERNAL_URL=http://127.0.0.1:43829`
- `APP_NAME=Bob`
- `ENABLE_GITHUB_AUTH=false` (or true if configured)

**Verification commands (on server):**

- `curl -sS -D - http://127.0.0.1:3000/api/config`
- `curl -sS -D - http://127.0.0.1:3000/api/repositories`

---

## Execution Options

Plan complete and saved to `docs/plans/2026-01-19-legacy-to-nextjs-hosted-migration-implementation-plan.md`.

Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
