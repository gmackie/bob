# Phase 3: Close the Loop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect agent runs to real ForgeGraph work items so the 7-stage pipeline progresses automatically. When `bob run WI-42` completes, the work item moves from "plan" to "execute" to "review".

**Architecture:** Agent runs already store a `workItemId`. We need to: (1) resolve that ID to a real work item, (2) update dispatchedTaskCount when a run starts and completedTaskCount when it finishes, (3) show runs on the work item detail page, and (4) show work item context on the runs pages.

**Tech Stack:** tRPC, Drizzle, existing stage detection system (`detectStage()`)

---

### Task 1: Link agent runs to work items in the publicApi router

**Files:**
- Modify: `packages/api/src/router/publicApi.ts`

The `createRun` procedure currently accepts any string as `workItemId`. Update it to validate the work item exists and store its UUID. Also update `updateRun` to record when runs complete so stage detection can count them.

**Step 1: Update createRun to validate work item**

In `publicApi.ts`, update the `createRun` procedure's mutation handler. After getting the workspace, add work item validation:

```typescript
// Inside createRun mutation, after workspace validation:
// Resolve the work item ID (supports both UUID and short identifier like "BOB-27")
const workItemResult = await ctx.db.query.workItems.findFirst({
  where: eq(workItems.id, input.workItemId),
});

// If not found by UUID, try as identifier (e.g., "BOB-27")
let resolvedWorkItemId = input.workItemId;
if (!workItemResult) {
  // Accept the ID as-is for now — ForgeGraph work items may not be in local DB
  // The ID will be stored and displayed, but won't validate against local DB
}
```

For now, keep accepting any string as workItemId — ForgeGraph work items may not be in the local DB. The important thing is that the ID is stored and can be looked up later.

**Step 2: Commit**

```bash
git commit -m "feat: document work item ID handling in publicApi router"
```

---

### Task 2: Add agent runs to work item detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/work-items/[workItemId]/page.tsx`
- Create: `apps/web/src/components/work-items/agent-runs-panel.tsx`

**Step 1: Create the AgentRunsPanel component**

```tsx
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Card } from "@bob/ui/card";
import { Badge } from "@bob/ui/badge";

import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

interface AgentRunsPanelProps {
  workItemId: string;
  workspaceId: string;
}

export function AgentRunsPanel({ workItemId, workspaceId }: AgentRunsPanelProps) {
  const trpc = useTRPC();

  const { data: allRuns } = useQuery(
    trpc.publicApi.listRuns.queryOptions(
      { workspaceId, limit: 50 },
      { enabled: !!workspaceId, refetchInterval: 10_000 },
    ),
  );

  // Filter runs for this work item
  const runs = (allRuns as any[] | undefined)?.filter(
    (r: any) => r.workItemId === workItemId,
  );

  if (!runs?.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Agent Runs</h3>
      <div className="flex flex-col gap-2">
        {runs.map((run: any) => (
          <Link key={run.id} href={`/runs/${run.id}`}>
            <Card className="hover:border-primary/30 flex items-center gap-3 p-3 transition-colors">
              <Badge
                className={cn(
                  "shrink-0 text-xs",
                  STATUS_COLORS[run.status] ?? STATUS_COLORS.queued,
                )}
              >
                {run.status}
              </Badge>
              <span className="text-sm font-medium">{run.agentType}</span>
              {run.summary?.duration_ms && (
                <span className="text-muted-foreground text-xs">
                  {run.summary.duration_ms < 1000
                    ? `${run.summary.duration_ms}ms`
                    : `${(run.summary.duration_ms / 1000).toFixed(1)}s`}
                </span>
              )}
              <span className="text-muted-foreground ml-auto text-xs">
                {run.artifacts?.length ?? 0} artifacts
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Add AgentRunsPanel to the work item detail page**

In the work item page, we need to import and render AgentRunsPanel. This varies depending on how the page is structured — the panel should appear in the sidebar or below the main content.

Read the existing page structure and add AgentRunsPanel where it makes sense (likely after the existing content panels). Pass workItemId and the workspace ID from the work item.

**Step 3: Commit**

```bash
git add apps/web/src/components/work-items/agent-runs-panel.tsx apps/web/src/app/\(dashboard\)/work-items/\[workItemId\]/page.tsx
git commit -m "feat: show agent runs on work item detail page"
```

---

### Task 3: Add listRunsByWorkItem procedure to publicApi

**Files:**
- Modify: `packages/api/src/router/publicApi.ts`

Currently `listRuns` filters by workspaceId. We need a way to list runs for a specific work item across all workspaces.

**Step 1: Add the procedure**

```typescript
// Add to publicApi router:
listRunsByWorkItem: apiKeyReadProcedure
  .input(
    z.object({
      workItemId: z.string().min(1),
      limit: z.number().min(1).max(100).default(20),
    }),
  )
  .query(async ({ ctx, input }) => {
    return ctx.db.query.agentRuns.findMany({
      where: eq(agentRuns.workItemId, input.workItemId),
      with: { artifacts: true },
      orderBy: [desc(agentRuns.createdAt)],
      limit: input.limit,
    });
  }),
```

**Step 2: Add REST adapter route**

Create `apps/web/src/app/api/v1/work-items/[workItemId]/runs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  try {
    const { workItemId } = await params;
    const caller = await createPublicApiCaller(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const result = await caller.publicApi.listRunsByWorkItem({
      workItemId,
      limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
```

**Step 3: Verify and commit**

Run: `cd /Volumes/dev/bob && pnpm typecheck`

```bash
git add packages/api/src/router/publicApi.ts apps/web/src/app/api/v1/work-items/
git commit -m "feat: add listRunsByWorkItem API endpoint"
```

---

### Task 4: Add work item link to runs list and detail pages

**Files:**
- Modify: `apps/web/src/app/(dashboard)/runs/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/runs/[runId]/page.tsx`

**Step 1: Update runs list page**

In the run card on the runs list page, make the workItemId a clickable link to the work item:

Change:
```tsx
<span className="font-mono text-xs font-medium text-neutral-500">
  {run.workItemId}
</span>
```

To:
```tsx
<Link
  href={`/work-items/${run.workItemId}`}
  className="font-mono text-xs font-medium text-neutral-500 hover:text-primary hover:underline"
  onClick={(e) => e.stopPropagation()}
>
  {run.workItemId}
</Link>
```

**Step 2: Update run detail page**

In the run detail header, make the workItemId a link:

Change the h1:
```tsx
<Link
  href={`/work-items/${run.workItemId}`}
  className="font-display text-2xl font-bold tracking-tight hover:text-primary"
>
  {run.workItemId}
</Link>
```

**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/runs/page.tsx apps/web/src/app/\(dashboard\)/runs/\[runId\]/page.tsx
git commit -m "feat: link work item IDs to work item detail pages"
```

---

### Task 5: Update bob CLI to show work item link in run output

**Files:**
- Modify: `~/dev/bob-cli/cmd/run.go`

**Step 1: Update the CLI output**

After the run completes, add a work item link alongside the run link:

```go
fmt.Printf("  View results: %s/runs/%s\n", cfg.APIBaseURL, run.ID)
fmt.Printf("  Work item:    %s/work-items/%s\n", cfg.APIBaseURL, workItemID)
```

Replace the `cfg.APIBaseURL` with the web URL (strip `/api` suffix):

```go
webURL := strings.TrimSuffix(cfg.APIBaseURL, "/api")
fmt.Printf("  View run:     %s/runs/%s\n", webURL, run.ID)
fmt.Printf("  Work item:    %s/work-items/%s\n", webURL, workItemID)
```

**Step 2: Build and test**

```bash
cd ~/dev/bob-cli && go build -o bob . && ./bob run --help
```

**Step 3: Commit**

```bash
git add cmd/run.go
git commit -m "feat: show work item link in bob run output"
```

---

### Task 6: Deploy and end-to-end test with a real work item

**Step 1: Deploy monorepo to labnuc**

```bash
rsync + build + restart (same deploy flow)
```

**Step 2: Deploy updated bob CLI**

```bash
cd ~/dev/bob-cli && GOOS=linux GOARCH=amd64 go build -o bob-linux .
scp bob-linux mackieg@192.168.0.204:~/bob-cli
```

**Step 3: Run bob against a real ForgeGraph work item**

Find an actual work item ID from the Bob web UI, then:

```bash
ssh mackieg@192.168.0.204 "cd ~/bob && ~/bob-cli run <REAL-WORK-ITEM-ID> --agent claude-code"
```

**Step 4: Verify**

1. The run shows up on the /runs page
2. The run shows the work item ID as a clickable link
3. Clicking the work item link opens the work item detail
4. The work item detail page shows the agent run
5. The work item's stage detection reflects the agent run

---

## Summary

**6 tasks:**
1. Document work item ID handling (accept any string for now)
2. AgentRunsPanel on work item detail page (shows runs for this item)
3. listRunsByWorkItem API endpoint (query runs by work item ID)
4. Link work item IDs on runs pages (clickable navigation)
5. Update CLI output with work item link
6. Deploy and e2e test with real work item

**After this plan:** The full loop works: user creates a work item in Bob, runs `bob run <work-item-id>`, and the web UI shows the run on both the /runs page and the work item's detail page. Work item stage detection sees the dispatched/completed counts from agent runs.
