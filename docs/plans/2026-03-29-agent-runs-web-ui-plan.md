# Agent Runs Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the web UI for viewing agent runs — the core observability surface of blder.bot. Dashboard shows recent runs, run detail shows artifacts and status.

**Architecture:** New Next.js pages at `/runs` (list) and `/runs/[runId]` (detail) using the existing tRPC `publicApi` procedures from the client. Add a "Runs" nav item to the sidebar. All components follow DESIGN.md (warm amber, Satoshi/DM Sans, industrial aesthetic).

**Tech Stack:** Next.js App Router, tRPC (tanstack-react-query), Tailwind CSS, @bob/ui components, Radix icons

---

### Task 1: Add "Runs" nav item to sidebar

**Files:**
- Modify: `apps/web/src/components/layout/sidebar-nav.tsx:19-57`

**Step 1: Add the Runs nav item**

In `sidebar-nav.tsx`, add a new entry to `NAV_ITEMS` after "Planning" (line 20). Use a play/activity icon:

```typescript
// Add after the Planning entry (line 20):
{
  icon: () => (
    <svg
      className="size-[15px]"
      viewBox="0 0 15 15"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.5 2C3.67 2 3 2.67 3 3.5v8c0 .83.67 1.5 1.5 1.5h6c.83 0 1.5-.67 1.5-1.5v-8c0-.83-.67-1.5-1.5-1.5h-6ZM5 5h5v1H5V5Zm0 2.5h5v1H5v-1Zm0 2.5h3v1H5V10Z" />
    </svg>
  ),
  label: "Runs",
  href: "/runs",
},
```

**Step 2: Verify**

Run: `cd /Volumes/dev/bob && pnpm typecheck`
Expected: PASS (the route doesn't need to exist yet for the nav link)

**Step 3: Commit**

```bash
git add apps/web/src/components/layout/sidebar-nav.tsx
git commit -m "feat: add Runs nav item to sidebar"
```

---

### Task 2: Create runs list page

**Files:**
- Create: `apps/web/src/app/(dashboard)/runs/page.tsx`

**Step 1: Create the page**

```tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Card } from "@bob/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function RunsPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const workspaceId = searchParams?.get("workspace") ?? "";

  // Fetch workspaces to get the first one if no workspace param
  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);
  const activeWorkspaceId = workspaceId || workspaces?.[0]?.id || "";

  const { data: runs, isLoading } = useQuery(
    trpc.publicApi.listRuns.queryOptions(
      { workspaceId: activeWorkspaceId, limit: 50 },
      { enabled: !!activeWorkspaceId, refetchInterval: 10_000 },
    ),
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs items={[{ label: "Runs" }]} />

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Agent Runs
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What your agents did, whether it worked, and what changed.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted/50 h-20 animate-pulse rounded-lg"
            />
          ))}
        </div>
      ) : !runs?.length ? (
        <Card className="p-8 text-center">
          <h3 className="font-display text-lg font-semibold">No runs yet</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            Run <code className="font-mono text-xs">bob run &lt;work-item-id&gt;</code> to launch an agent and see results here.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run: any) => (
            <Link key={run.id} href={`/runs/${run.id}`}>
              <Card className="hover:border-primary/30 flex items-center gap-4 p-4 transition-colors">
                {/* Status badge */}
                <Badge
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    STATUS_COLORS[run.status] ?? STATUS_COLORS.queued,
                  )}
                >
                  {run.status}
                </Badge>

                {/* Main info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-neutral-500">
                      {run.workItemId}
                    </span>
                    <span className="text-muted-foreground text-xs">via</span>
                    <span className="text-sm font-medium">{run.agentType}</span>
                  </div>
                  {run.summary && (
                    <div className="text-muted-foreground mt-0.5 flex gap-3 text-xs">
                      {run.summary.files_changed > 0 && (
                        <span>{run.summary.files_changed} files changed</span>
                      )}
                      {run.summary.duration_ms && (
                        <span>{formatDuration(run.summary.duration_ms)}</span>
                      )}
                      {run.summary.exit_code !== undefined &&
                        run.summary.exit_code !== 0 && (
                          <span className="text-red-500">
                            exit {run.summary.exit_code}
                          </span>
                        )}
                    </div>
                  )}
                </div>

                {/* Artifact count */}
                {run.artifacts?.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {run.artifacts.length} artifact
                    {run.artifacts.length !== 1 ? "s" : ""}
                  </span>
                )}

                {/* Time */}
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatRelativeTime(run.createdAt)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify it builds**

Run: `cd /Volumes/dev/bob && pnpm typecheck`

**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/runs/page.tsx
git commit -m "feat: add agent runs list page"
```

---

### Task 3: Create run detail page

**Files:**
- Create: `apps/web/src/app/(dashboard)/runs/[runId]/page.tsx`

**Step 1: Create the page**

```tsx
"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  CrossCircledIcon,
  ClockIcon,
} from "@radix-ui/react-icons";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Card } from "@bob/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircledIcon,
  failed: CrossCircledIcon,
  running: ClockIcon,
  queued: ClockIcon,
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const ARTIFACT_LABELS: Record<string, string> = {
  diff: "Diff",
  log: "Agent Log",
  "test-report": "Test Report",
  "file-snapshot": "File Snapshot",
};

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const trpc = useTRPC();

  const { data: run, isLoading } = useQuery(
    trpc.publicApi.getRun.queryOptions(
      { runId },
      { refetchInterval: (query) => query.state.data?.status === "running" ? 3000 : false },
    ),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="bg-muted/50 h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted/50 h-40 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[run.status] ?? ClockIcon;
  const duration = run.summary?.duration_ms;
  const filesChanged = run.summary?.files_changed ?? 0;
  const exitCode = run.summary?.exit_code;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        items={[
          { label: "Runs", href: "/runs" },
          { label: run.workItemId },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <StatusIcon
              className={cn(
                "size-5",
                run.status === "completed" && "text-green-600 dark:text-green-400",
                run.status === "failed" && "text-red-600 dark:text-red-400",
                run.status === "running" && "text-amber-600 dark:text-amber-400",
              )}
            />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {run.workItemId}
            </h1>
            <Badge
              className={cn(
                "text-xs font-medium",
                STATUS_COLORS[run.status],
              )}
            >
              {run.status}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            via <span className="font-medium">{run.agentType}</span>
            {duration && <> in {formatDuration(duration)}</>}
          </p>
        </div>
        <Link
          href="/runs"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" /> All runs
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Status
          </p>
          <p className="mt-1 text-lg font-semibold capitalize">{run.status}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Duration
          </p>
          <p className="mt-1 text-lg font-semibold">
            {duration ? formatDuration(duration) : "—"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Files Changed
          </p>
          <p className="mt-1 text-lg font-semibold">{filesChanged}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Exit Code
          </p>
          <p
            className={cn(
              "mt-1 text-lg font-semibold",
              exitCode !== 0 && exitCode !== undefined && "text-red-600",
            )}
          >
            {exitCode ?? "—"}
          </p>
        </Card>
      </div>

      {/* Artifacts */}
      <div>
        <h2 className="font-display mb-3 text-lg font-semibold">Artifacts</h2>
        {!run.artifacts?.length ? (
          <Card className="p-6 text-center">
            <p className="text-muted-foreground text-sm">
              No artifacts collected for this run.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {run.artifacts.map((artifact: any) => (
              <Card key={artifact.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">
                      {ARTIFACT_LABELS[artifact.type] ?? artifact.type}
                    </span>
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {artifact.storageKey.split("/").pop()}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {new Date(artifact.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {/* Metadata display */}
                {artifact.metadata && Object.keys(artifact.metadata).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {Object.entries(artifact.metadata).map(([key, value]) => (
                      <span
                        key={key}
                        className="text-muted-foreground text-xs"
                      >
                        <span className="font-medium">
                          {key.replace(/_/g, " ")}:
                        </span>{" "}
                        {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Run metadata */}
      <Card className="p-4">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
          Run Details
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Run ID:</span>{" "}
            <span className="font-mono text-xs">{run.id}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Agent:</span>{" "}
            {run.agentType}
          </div>
          <div>
            <span className="text-muted-foreground">Started:</span>{" "}
            {run.startedAt
              ? new Date(run.startedAt).toLocaleString()
              : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Completed:</span>{" "}
            {run.completedAt
              ? new Date(run.completedAt).toLocaleString()
              : "—"}
          </div>
        </div>
      </Card>
    </div>
  );
}
```

**Step 2: Verify it builds**

Run: `cd /Volumes/dev/bob && pnpm typecheck`

**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/runs/\[runId\]/page.tsx
git commit -m "feat: add agent run detail page with artifacts"
```

---

### Task 4: Add runs widget to the Mission Control dashboard

**Files:**
- Create: `apps/web/src/components/dashboard/recent-runs.tsx`
- Modify: `apps/web/src/components/dashboard/mission-control.tsx:13-35`

**Step 1: Create the RecentRuns component**

```tsx
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

import { useTRPC } from "~/trpc/react";

const STATUS_DOT: Record<string, string> = {
  queued: "bg-neutral-400",
  running: "bg-amber-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
};

interface RecentRunsProps {
  workspaceId: string;
}

export function RecentRuns({ workspaceId }: RecentRunsProps) {
  const trpc = useTRPC();

  const { data: runs, isLoading } = useQuery(
    trpc.publicApi.listRuns.queryOptions(
      { workspaceId, limit: 5 },
      { enabled: !!workspaceId, refetchInterval: 10_000 },
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recent Runs</h3>
        <Link
          href="/runs"
          className="text-primary text-xs hover:underline"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted/50 h-10 animate-pulse rounded"
            />
          ))}
        </div>
      ) : !runs?.length ? (
        <p className="text-muted-foreground text-xs">
          No agent runs yet. Run{" "}
          <code className="font-mono">bob run</code> to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {runs.map((run: any) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
            >
              <div
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  STATUS_DOT[run.status] ?? STATUS_DOT.queued,
                )}
              />
              <span className="font-mono text-xs text-neutral-500">
                {run.workItemId}
              </span>
              <span className="text-xs">{run.agentType}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                {run.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add RecentRuns to MissionControl**

In `mission-control.tsx`, import and add the component. Replace the SkillUsage slot in the right column:

Add import:
```typescript
import { RecentRuns } from "./recent-runs";
```

In the right column div, add RecentRuns before AttentionPanel:
```tsx
<div className="flex flex-col gap-5">
  <RecentRuns workspaceId={workspaceId ?? ""} />
  <AttentionPanel />
  <SkillUsage />
</div>
```

**Step 3: Verify it builds**

Run: `cd /Volumes/dev/bob && pnpm typecheck`

**Step 4: Commit**

```bash
git add apps/web/src/components/dashboard/recent-runs.tsx apps/web/src/components/dashboard/mission-control.tsx
git commit -m "feat: add recent runs widget to mission control dashboard"
```

---

### Task 5: Deploy and verify on labnuc

**Step 1: Build and deploy**

```bash
rsync -avz --exclude='node_modules' --exclude='.next' --exclude='.turbo' \
  --exclude='apps/mobile' --exclude='apps/nextjs' --exclude='.git' \
  --exclude='*.framework' --exclude='ios' --exclude='Pods' \
  --exclude='playwright-report' --exclude='.env' \
  /Volumes/dev/bob/ mackieg@192.168.0.204:~/bob/

ssh mackieg@192.168.0.204 "export PNPM_HOME='/home/mackieg/.local/share/pnpm' && export PATH=\"\$PNPM_HOME:\$PATH\" && cd ~/bob && pnpm --filter @bob/api build && rm -rf apps/web/.next && pnpm --filter web build"

ssh mackieg@192.168.0.204 "sudo systemctl stop bob-web && sudo fuser -k 3100/tcp 2>/dev/null; sleep 1 && sudo systemctl start bob-web"
```

**Step 2: Verify**

1. Open https://bob.tail1e1a32.ts.net/runs — should show the agent runs list with the dogfood runs
2. Click a run — should show the detail page with artifacts
3. Check the sidebar — "Runs" should appear between Planning and Pull Requests
4. Check the dashboard — Recent Runs widget should show in the right column

**Step 3: Commit if any fixes needed**

---

## Summary

**5 tasks:**
1. Sidebar nav item (Runs link)
2. Runs list page (`/runs`) — skeleton loading, empty state, run cards with status/agent/duration
3. Run detail page (`/runs/[runId]`) — status header, summary cards, artifact list, metadata
4. Recent Runs dashboard widget — compact run list in Mission Control right column
5. Deploy and verify on labnuc

**After this plan:** The web UI shows agent runs with observability data. Users can see what agents did, how long it took, whether it succeeded, and what artifacts were produced. This is the core of the "agent observability and trust" value prop.
