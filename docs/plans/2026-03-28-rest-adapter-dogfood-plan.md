# REST Adapter + Dogfood Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the bob CLI to the existing Bob backend via REST adapter routes, then dogfood the full loop on labnuc.

**Architecture:** Next.js API routes at /api/v1/* that call the publicApi tRPC procedures directly. The bob CLI POSTs JSON to these routes with Bearer token auth.

**Tech Stack:** Next.js App Router API routes, existing tRPC procedures, API key auth

---

### Task 1: Switch publicApi router to API key auth

**Files:**
- Modify: `packages/api/src/router/publicApi.ts`

Change all procedures from `protectedProcedure` to the appropriate API key procedure:
- Mutations (registerWorkspace, createRun, updateRun, createArtifact, heartbeat, generateApiKey): use `apiKeyWriteProcedure`
- Queries (getRun, listRuns): use `apiKeyReadProcedure`
- generateApiKey is special: it needs session auth (user generates key from web UI), keep as `protectedProcedure`

Update imports from `../trpc` to include `apiKeyReadProcedure` and `apiKeyWriteProcedure`.

### Task 2: Add REST adapter routes

**Files:**
- Create: `apps/web/src/app/api/v1/runs/route.ts` (POST create, GET list)
- Create: `apps/web/src/app/api/v1/runs/[runId]/route.ts` (GET detail, PATCH update)
- Create: `apps/web/src/app/api/v1/runs/[runId]/artifacts/route.ts` (POST create)
- Create: `apps/web/src/app/api/v1/workspaces/route.ts` (POST register)
- Create: `apps/web/src/app/api/v1/workspaces/[workspaceId]/heartbeat/route.ts` (POST)

Each route:
1. Extracts Bearer token from Authorization header
2. Validates the API key using validateApiKey from @bob/auth
3. Calls the tRPC procedure directly (server-side caller)
4. Returns JSON response

### Task 3: Test with curl from local machine

Manually test the REST endpoints work:
1. Generate an API key via the web UI (or seed script)
2. curl POST /api/v1/workspaces with the key
3. curl POST /api/v1/runs
4. curl GET /api/v1/runs/:id

### Task 4: Configure bob CLI on labnuc

1. Copy the bob binary to labnuc
2. Create ~/.config/bob/config.yaml with:
   - api_base_url: https://bob.tail1e1a32.ts.net/api
   - api_key: (generated key)
   - default_agent: smol-agent (or claude)
   - agents config
3. Run bob init in a project directory
4. Run bob run against a real work item
5. Verify artifacts show up in the Bob web UI
