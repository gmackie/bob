# Phase 5: End-to-End Wiring, Streaming, Wiki Graph, Notifications, t3code Plugins

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the full stack end-to-end, add streaming responses, wiki graph visualization, mobile push notifications, provenance linking, and prepare t3code extension manifests.

**Tech Stack:** Existing Effect server + PGlite, SSE for streaming, @xyflow/react for graph, expo-notifications, t3code extension API

---

## Phase 5A: End-to-End Stack Boot

### Task 33: Schema migration and full stack boot script

**Files:**
- Create: `packages/db/src/migrate.ts`
- Modify: `packages/db/package.json`
- Create: `scripts/dev.sh`

**Step 1: Create migration script**

PGlite needs the schema pushed programmatically since drizzle-kit's push command expects a real Postgres connection. Create a script that uses PGlite + Drizzle's migrate or push API to set up tables.

```ts
// packages/db/src/migrate.ts
import { getDb } from "./client";

export async function migrate() {
  const db = await getDb();
  // Use Drizzle's push or raw SQL to create tables
  // For PGlite, we can use raw SQL from the schema definitions
  await db.execute(`
    DO $$ BEGIN
      CREATE TYPE thread_status AS ENUM ('active', 'paused', 'archived', 'completed');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;

    CREATE TABLE IF NOT EXISTS thread (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(256) NOT NULL,
      status thread_status NOT NULL DEFAULT 'active',
      active_branch_id UUID,
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS branch (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      parent_branch_id UUID,
      fork_point_message_id UUID,
      name VARCHAR(256) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS message (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
      branch_id UUID NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
      parent_id UUID,
      role message_role NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  console.log("Schema migrated successfully");
}
```

**Step 2: Add migrate script to package.json**

```json
"db:migrate:pglite": "tsx src/migrate.ts"
```

**Step 3: Create dev boot script**

```bash
#!/bin/bash
# scripts/dev.sh — boot the full gmacko stack
set -e

echo "=== Gmacko Dev Stack ==="

# 1. Migrate database
echo "[1/3] Migrating database..."
cd packages/db && pnpm db:migrate:pglite && cd ../..

# 2. Start server
echo "[2/3] Starting Effect server on :3001..."
cd apps/server && pnpm dev &
SERVER_PID=$!
sleep 2

# 3. Start web
echo "[3/3] Starting Next.js on :3000..."
cd ../web && pnpm dev &
WEB_PID=$!

echo ""
echo "Stack running:"
echo "  Server: http://localhost:3001"
echo "  Web:    http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all"

trap "kill $SERVER_PID $WEB_PID 2>/dev/null" EXIT
wait
```

**Step 4: Auto-migrate on server start**

Update `apps/server/src/index.ts` to call migrate() before starting the HTTP server.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add schema migration for PGlite and dev boot script"
```

---

## Phase 5B: Streaming Responses

### Task 34: Add SSE streaming to agent chat

**Files:**
- Modify: `packages/contracts/src/rpc.ts` — add streaming RPC for agent chat
- Create: `apps/server/src/services/stream-handler.ts`
- Modify: `apps/web/src/rpc/client.ts` — add SSE client
- Modify: `apps/web/src/app/page.tsx` — render streaming tokens

**Step 1: Add streaming endpoint**

Instead of modifying the RPC group (which requires Effect streaming support), add a simple SSE endpoint alongside the RPC server:

```ts
// apps/server/src/sse.ts
// POST /api/chat/stream — receives { threadId, branchId, content }
// Returns SSE stream of { type: "token", text } and { type: "done", messageId }
```

The server:
1. Saves user message to DB
2. Loads conversation history
3. Calls dispatchAgent (the async generator)
4. Streams each text chunk as an SSE event
5. On completion, saves assistant message to DB, sends done event

**Step 2: Add SSE client to web app**

```ts
// In rpc/client.ts
export function streamChat(input: { threadId: string; branchId: string; content: string }, 
  onToken: (text: string) => void,
  onDone: (messageId: string) => void,
) {
  const es = new EventSource(...) // or fetch with ReadableStream
}
```

**Step 3: Update page.tsx to show streaming tokens**

When user sends a message:
1. Add user message bubble immediately
2. Add empty assistant bubble
3. As tokens stream in, append to assistant bubble content
4. On done, replace with final message from cache

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add SSE streaming for agent chat responses"
```

---

## Phase 5C: Thread↔Wiki Bidirectional Loop

### Task 35: Add provenance links and wiki re-entry

**Files:**
- Modify: `packages/wiki/src/writer.ts` — add provenance frontmatter
- Create: `apps/web/src/app/wiki/page.tsx` — wiki browser
- Create: `apps/web/src/app/wiki/[slug]/page.tsx` — wiki article view with "explore further" button
- Modify: `apps/web/src/rpc/hooks.ts` — add wiki hooks
- Modify: `apps/web/src/rpc/client.ts` — ensure wiki methods exist

**Step 1: Wiki browser page**

List all wiki articles with search/filter. Shows title, tags, link count.

**Step 2: Wiki article page**

Renders article content as markdown. Shows:
- Frontmatter: source thread link, creation date, tags
- Content body
- Related articles as clickable wikilinks
- "Explore Further" button — creates a new thread seeded with this article's content

**Step 3: "Explore Further" action**

When clicked:
1. Creates a new thread titled "Exploring: [article title]"
2. Creates a system message with the article content as context
3. Redirects to the thread view
4. User can then chat with the agent about the article, branching off

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add wiki browser with provenance links and explore-further"
```

---

## Phase 5D: Wiki Graph Visualization

### Task 36: Add graph view of wiki articles

**Files:**
- Create: `packages/ui/src/wiki-graph/wiki-graph.tsx`
- Create: `packages/ui/src/wiki-graph/index.ts`
- Create: `apps/web/src/app/graph/page.tsx`
- Modify: `apps/web/package.json` — add @xyflow/react

**Step 1: Install @xyflow/react**

**Step 2: Create WikiGraph component**

Uses React Flow to render wiki articles as nodes and wikilinks as edges:
- Each article is a node with title + tag badges
- Each [[wikilink]] is a directed edge
- Nodes colored by tag or source thread
- Click a node → navigate to /wiki/[slug]
- Orphaned articles highlighted in a different color
- Auto-layout using dagre or elk

**Step 3: Create graph page**

Full-screen graph view at /graph. Includes:
- Zoom/pan controls
- Node count + edge count stats
- Filter by tag
- Search to highlight specific articles

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add wiki graph visualization with React Flow"
```

---

## Phase 5E: Mobile Push Notifications

### Task 37: Add push notifications for exploration check-ins

**Files:**
- Modify: `apps/mobile/package.json` — add expo-notifications
- Create: `apps/mobile/src/hooks/use-push-notifications.ts`
- Create: `apps/mobile/src/providers/notification-provider.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Modify: `apps/server/src/services/explorer.ts` — emit notification events

**Step 1: Set up expo-notifications**

Register for push notifications, get device token.

**Step 2: Create polling-based notification provider**

Since we don't have a push server yet, poll the exploration.list endpoint every 20 seconds. When a new check-in with status "awaiting_input" appears, trigger a local notification.

**Step 3: Handle notification taps**

Navigate to /explore screen when user taps a notification.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add mobile push notifications for exploration check-ins"
```

---

## Phase 5F: t3code Extension Prep

### Task 38: Create t3code extension manifests

**Files:**
- Create: `packages/ext-ooda/package.json`
- Create: `packages/ext-ooda/src/manifest.ts`
- Create: `packages/ext-ooda/src/index.ts`
- Create: `packages/ext-ooda/src/panels/research-panel.tsx`
- Create: `packages/ext-ooda/src/panels/wiki-panel.tsx`
- Create: `packages/ext-ooda/src/panels/capture-panel.tsx`

**Step 1: Create extension package**

Following t3code's extension pattern from bob-main-local:
- ExtensionManifest with id, name, version, hostVersionRange
- Slot registrations: thread.sidePanel, threads.sidebar.section, thread.header.actions
- Capability declarations: read.thread-view, action.open-thread, etc.

**Step 2: Create panel components**

Three panels for the t3code sidebar:
1. **Research Panel** — shows exploration status, check-ins, quick actions
2. **Wiki Panel** — browse/search wiki articles, show mini graph
3. **Capture Panel** — quick text + voice input for rapid ideas

These are thin wrappers around the existing web components, adapted for t3code's panel slot API.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add t3code extension manifest with OODA panels"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 33 | Schema migration for PGlite, dev boot script, auto-migrate on start |
| 34 | SSE streaming for agent chat — real-time token display |
| 35 | Wiki browser, article view, provenance links, "explore further" |
| 36 | Wiki graph visualization with React Flow |
| 37 | Mobile push notifications for exploration check-ins |
| 38 | t3code extension manifests for OODA panels |
