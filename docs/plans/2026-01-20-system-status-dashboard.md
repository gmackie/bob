# System Status Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a main homepage dashboard panel that reports agent status and host/system capabilities, so we can diagnose missing CLIs and host dependencies without VM console access.

**Architecture:** Add a single aggregate Next.js API endpoint `GET /api/system-status` (Node runtime) that returns agent info + host dependency checks. Add a small UI panel on `/` that fetches this endpoint client-side and renders a compact status table.

**Tech Stack:** Next.js App Router, TypeScript, Playwright E2E (existing), legacy agent detection via `@bob/legacy`.

---

### Task 1: Add failing API test for `/api/system-status`

**Files:**
- Create: `apps/nextjs/e2e/specs/system-status-api.spec.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "@playwright/test";

test("/api/system-status returns agent + host dependency info", async ({ request }) => {
  const res = await request.get("/api/system-status");
  expect(res.ok()).toBeTruthy();

  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toContain("application/json");

  const json = await res.json();
  expect(json).toHaveProperty("timestamp");
  expect(json).toHaveProperty("agents");
  expect(Array.isArray(json.agents)).toBe(true);
  expect(json).toHaveProperty("hostDependencies");
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm -F @bob/nextjs test:e2e --project=chromium -- e2e/specs/system-status-api.spec.ts
```

Expected: FAIL because `/api/system-status` is 404.

**Step 3: Commit**

```bash
git add apps/nextjs/e2e/specs/system-status-api.spec.ts
git commit -m "test: add /api/system-status contract"
```

---

### Task 2: Implement `GET /api/system-status`

**Files:**
- Create: `apps/nextjs/src/app/api/system-status/route.ts`

**Step 1: Implement minimal endpoint (Node runtime)**

Requirements:
- Must run on Node (`export const runtime = "nodejs"`).
- Must return JSON `{ timestamp, agents, hostDependencies }`.
- `agents` should come from `agentFactory.getAgentInfo()`.
- Each agent should include `pathInfo` from `getAgentPathInfo(agentType)`.
- `hostDependencies` should check: `git`, `gh`, `docker`, `node`, `pnpm`, `rsync`.
- No secrets/env var output. Only: availability + version first line + status message.

**Suggested implementation skeleton:**

```ts
import { NextResponse } from "next/server";

import { agentFactory } from "@bob/legacy/agents";
import { getAgentPathInfo, type AgentType } from "@bob/legacy";

import { spawn } from "node:child_process";

export const runtime = "nodejs";

// ... helper runVersionCommand() with timeout ...
// ... build hostDependencies[] ...

export async function GET() {
  const agents = await agentFactory.getAgentInfo();
  const hostDependencies = await getHostDependencies();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    agents: agents.map((a) => ({ ...a, pathInfo: getAgentPathInfo(a.type as AgentType) })),
    hostDependencies,
  });
}
```

**Step 2: Run test to verify it passes**

Run:
```bash
pnpm -F @bob/nextjs test:e2e --project=chromium -- e2e/specs/system-status-api.spec.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/nextjs/src/app/api/system-status/route.ts
git commit -m "feat: add /api/system-status endpoint"
```

---

### Task 3: Add a homepage System Status panel UI

**Files:**
- Create: `apps/nextjs/src/components/dashboard/SystemStatusPanel.tsx`
- Modify: `apps/nextjs/src/app/(dashboard)/page.tsx`

**Step 1: Write a failing e2e UI test (optional but recommended)**

If adding UI test coverage, keep it minimal and non-brittle:

```ts
import { expect, test } from "@playwright/test";

test("homepage renders System Status panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("System Status")).toBeVisible();
});
```

Run:
```bash
pnpm -F @bob/nextjs test:e2e --project=chromium -- e2e/specs/<new-spec>.spec.ts
```

Expected: FAIL until UI is added.

**Step 2: Implement `SystemStatusPanel` (client component)**

Requirements:
- `"use client"`.
- Fetch `/api/system-status` with `cache: "no-store"`.
- Render three states: loading, error (+ retry), success.
- Render agents in a compact list: name/type, installed/missing, version, auth status.
- Render host dependencies similarly.
- Keep styling consistent with existing dashboard (dark gray panels, subtle borders, small text).
- Must not assume any repos/worktrees exist.

**Step 3: Integrate into homepage**

In `apps/nextjs/src/app/(dashboard)/page.tsx`, add:

```ts
import { SystemStatusPanel } from "~/components/dashboard/SystemStatusPanel";
```

Then render it near the top of the page, so it’s visible even when no worktree is selected.

**Step 4: Run app build**

Run:
```bash
pnpm -F @bob/nextjs build
```

Expected: exit code 0.

**Step 5: Commit**

```bash
git add apps/nextjs/src/components/dashboard/SystemStatusPanel.tsx apps/nextjs/src/app/(dashboard)/page.tsx
git commit -m "feat: show system status on homepage"
```

---

### Task 4: Deploy to `claude.gmac.io` via rsync and restart service

**Files to deploy (minimum):**
- `apps/nextjs/src/app/api/system-status/route.ts`
- `apps/nextjs/src/components/dashboard/SystemStatusPanel.tsx`
- `apps/nextjs/src/app/(dashboard)/page.tsx`

**Step 1: rsync code to VM**

Run from repo root:
```bash
rsync -av --relative \
  "apps/nextjs/src/app/api/system-status/route.ts" \
  "apps/nextjs/src/components/dashboard/SystemStatusPanel.tsx" \
  "apps/nextjs/src/app/(dashboard)/page.tsx" \
  root@claude.gmac.io:/opt/bob-nextjs/
```

**Step 2: Fix ownership and rebuild on VM**

Run:
```bash
ssh root@claude.gmac.io '
  set -euo pipefail
  chown -R bob:bob /opt/bob-nextjs/apps/nextjs/src/app/api/system-status
  chown bob:bob /opt/bob-nextjs/apps/nextjs/src/components/dashboard/SystemStatusPanel.tsx
  chown bob:bob "/opt/bob-nextjs/apps/nextjs/src/app/(dashboard)/page.tsx"

  su -s /bin/bash - bob -c "
    set -euo pipefail
    source ~/.nvm/nvm.sh
    nvm use 22 >/dev/null
    cd /opt/bob-nextjs
    pnpm -F @bob/legacy build
    pnpm -F @bob/nextjs build
  "

  systemctl restart bob-nextjs.service
  systemctl status bob-nextjs.service --no-pager -l | head -n 25
'
```

Expected:
- `pnpm -F @bob/nextjs build` succeeds.
- Service is `active (running)`.

**Step 3: Verify in browser**

Navigate to:
- `https://claude.gmac.io/`
- Confirm "System Status" panel renders.
- Confirm it shows `claude` and `opencode` as available.

---

### Task 5: (Optional) Add a dedicated page `/system-status`

If the homepage panel isn’t enough, add a page with more room for details (expanded path info, etc.). Keep `/` panel as a summary.

**Files:**
- Create: `apps/nextjs/src/app/(dashboard)/system-status/page.tsx`

**Verify:**
- `GET /api/system-status` remains the only data source.
- `/system-status` renders reliably even when no repos exist.
