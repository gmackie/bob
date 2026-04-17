"use client";

import { use, useState } from "react";
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

// ── Constants ─────────────────────────────────────────────────────────

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

function getSummary(run: any, key: string): unknown {
  return run?.summary?.[key] ?? null;
}

// ── Mock Data ─────────────────────────────────────────────────────────

const MOCK_CHAT = [
  { role: "user", content: "Add a health check endpoint to the API that returns service status, uptime, and dependency health." },
  { role: "assistant", content: "I'll add a health check endpoint. Let me start by examining the existing API structure.", tool: "Read apps/api/src/index.ts" },
  { role: "assistant", content: "I can see the Express app setup. I'll add a `/health` endpoint that checks:\n1. Database connectivity\n2. Redis connection\n3. Service uptime\n4. Memory usage", tool: "Write apps/api/src/routes/health.ts" },
  { role: "assistant", content: "Now let me register the route and add tests.", tool: "Edit apps/api/src/index.ts" },
  { role: "assistant", content: "Writing the test file for the health endpoint.", tool: "Write apps/api/src/routes/__tests__/health.test.ts" },
  { role: "tool", content: "✓ 4 tests passed (health.test.ts)" },
  { role: "assistant", content: "Health check endpoint is live at `GET /health`. Returns `{ status: 'ok', uptime: 12345, checks: { db: 'ok', redis: 'ok' } }`. All 4 tests pass." },
];

const MOCK_FILES = [
  { path: "apps/api/src/routes/health.ts", status: "added", additions: 47, deletions: 0 },
  { path: "apps/api/src/routes/__tests__/health.test.ts", status: "added", additions: 82, deletions: 0 },
  { path: "apps/api/src/index.ts", status: "modified", additions: 3, deletions: 0 },
  { path: "apps/api/package.json", status: "modified", additions: 1, deletions: 0 },
];

const MOCK_DIFF = `diff --git a/apps/api/src/routes/health.ts b/apps/api/src/routes/health.ts
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/apps/api/src/routes/health.ts
@@ -0,0 +1,47 @@
+import { Router } from "express";
+import { db } from "../db";
+import { redis } from "../redis";
+
+const router = Router();
+const startTime = Date.now();
+
+router.get("/health", async (req, res) => {
+  const checks: Record<string, string> = {};
+
+  // Database check
+  try {
+    await db.raw("SELECT 1");
+    checks.db = "ok";
+  } catch {
+    checks.db = "error";
+  }
+
+  // Redis check
+  try {
+    await redis.ping();
+    checks.redis = "ok";
+  } catch {
+    checks.redis = "error";
+  }
+
+  const allOk = Object.values(checks).every((v) => v === "ok");
+
+  res.status(allOk ? 200 : 503).json({
+    status: allOk ? "ok" : "degraded",
+    uptime: Date.now() - startTime,
+    checks,
+    memory: process.memoryUsage(),
+  });
+});
+
+export default router;

diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index 1234567..89abcde 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -12,6 +12,7 @@ import { authRouter } from "./routes/auth";
 import { apiRouter } from "./routes/api";
+import healthRouter from "./routes/health";
 
 const app = express();
@@ -24,6 +25,7 @@ app.use("/auth", authRouter);
 app.use("/api", apiRouter);
+app.use(healthRouter);
 
 export default app;`;

// ── Tab types ─────────────────────────────────────────────────────────

type Tab = "summary" | "chat" | "files" | "diff" | "artifacts";

const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "chat", label: "Chat" },
  { key: "files", label: "Files" },
  { key: "diff", label: "Diff" },
  { key: "artifacts", label: "Artifacts" },
];

// ── Page ──────────────────────────────────────────────────────────────

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const trpc = useTRPC();
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [useMock, setUseMock] = useState(false);

  const { data: run, isLoading } = useQuery(
    trpc.agentRun.get.queryOptions(
      { runId },
      {
        refetchInterval: (query) =>
          query.state.data?.status === "running" ? 3000 : false,
      },
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
  const duration = getSummary(run, "duration_ms") as number | null;
  const filesChanged = (getSummary(run, "files_changed") as number) ?? 0;
  const exitCode = getSummary(run, "exit_code") as number | null;

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
                run.status === "completed" && "text-green-600",
                run.status === "failed" && "text-red-600",
                run.status === "running" && "text-amber-600",
              )}
            />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              <Link href={`/work-items/${run.workItemId}`} className="hover:text-primary">
                {run.workItemId}
              </Link>
            </h1>
            <Badge className={cn("text-xs font-medium", STATUS_COLORS[run.status])}>
              {run.status}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            via <span className="font-medium">{run.agentType}</span>
            {duration && <> in {formatDuration(duration)}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useMock}
              onChange={(e) => setUseMock(e.target.checked)}
              className="rounded"
            />
            Mock data
          </label>
          <Link
            href="/runs"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
          >
            <ArrowLeftIcon className="size-3.5" /> All runs
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "summary" && <SummaryTab run={run} duration={duration} filesChanged={filesChanged} exitCode={exitCode} />}
      {activeTab === "chat" && <ChatTab run={run} useMock={useMock} />}
      {activeTab === "files" && <FilesTab run={run} useMock={useMock} />}
      {activeTab === "diff" && <DiffTab run={run} useMock={useMock} />}
      {activeTab === "artifacts" && <ArtifactsTab run={run} />}
    </div>
  );
}

// ── Summary Tab ───────────────────────────────────────────────────────

function SummaryTab({ run, duration, filesChanged, exitCode }: {
  run: any; duration: number | null; filesChanged: number; exitCode: number | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Status</p>
          <p className="mt-1 text-lg font-semibold capitalize">{run.status}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Duration</p>
          <p className="mt-1 text-lg font-semibold">{duration ? formatDuration(duration) : "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Files Changed</p>
          <p className="mt-1 text-lg font-semibold">{filesChanged}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Exit Code</p>
          <p className={cn("mt-1 text-lg font-semibold", exitCode !== 0 && exitCode != null && "text-red-600")}>
            {exitCode ?? "—"}
          </p>
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">Run Details</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <div><span className="text-muted-foreground">Run ID:</span> <span className="font-mono text-xs">{run.id}</span></div>
          <div><span className="text-muted-foreground">Agent:</span> {run.agentType}</div>
          <div><span className="text-muted-foreground">Started:</span> {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</div>
          <div><span className="text-muted-foreground">Completed:</span> {run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</div>
          <div><span className="text-muted-foreground">Work Item:</span> <Link href={`/work-items/${run.workItemId}`} className="text-primary hover:underline">{run.workItemId}</Link></div>
          <div><span className="text-muted-foreground">Workspace:</span> <span className="font-mono text-xs">{run.workspaceId}</span></div>
        </div>
      </Card>
    </div>
  );
}

// ── Chat Tab ──────────────────────────────────────────────────────────

function ChatTab({ run, useMock }: { run: any; useMock: boolean }) {
  const messages = useMock ? MOCK_CHAT : [];
  const logArtifact = run.artifacts?.find((a: any) => a.type === "log");

  if (!useMock && !logArtifact) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No chat log captured for this run. Toggle "Mock data" to preview the UI.
        </p>
      </Card>
    );
  }

  if (!useMock && logArtifact) {
    return (
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-medium">Agent Output</h3>
        <pre className="overflow-x-auto rounded bg-muted p-4 font-mono text-xs leading-relaxed max-h-[600px] overflow-y-auto">
          {logArtifact.metadata?.content || `${logArtifact.metadata?.lines ?? 0} lines captured`}
        </pre>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={cn(
            "rounded-lg p-4",
            msg.role === "user" && "bg-primary/5 border border-primary/10",
            msg.role === "assistant" && "bg-card border border-border",
            msg.role === "tool" && "bg-muted/50 border border-border",
          )}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider",
              msg.role === "user" && "text-primary",
              msg.role === "assistant" && "text-foreground",
              msg.role === "tool" && "text-green-600",
            )}>
              {msg.role === "user" ? "You" : msg.role === "assistant" ? "Claude" : "Tool"}
            </span>
            {msg.tool && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {msg.tool}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>
      ))}
    </div>
  );
}

// ── Files Tab ─────────────────────────────────────────────────────────

function FilesTab({ run, useMock }: { run: any; useMock: boolean }) {
  const files = useMock ? MOCK_FILES : [];
  const diffArtifact = run.artifacts?.find((a: any) => a.type === "diff");

  if (!useMock && !diffArtifact) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No file change data for this run. Toggle "Mock data" to preview.
        </p>
      </Card>
    );
  }

  if (!useMock && diffArtifact?.metadata?.files) {
    const fileList = diffArtifact.metadata.files as Array<{ path: string; status: string; additions: number; deletions: number }>;
    return <FileList files={fileList} />;
  }

  return <FileList files={files} />;
}

function FileList({ files }: { files: Array<{ path: string; status: string; additions: number; deletions: number }> }) {
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
        <span>{files.length} files</span>
        <span className="text-green-600">+{totalAdditions}</span>
        <span className="text-red-600">-{totalDeletions}</span>
      </div>
      <div className="rounded-lg border border-border divide-y divide-border">
        {files.map((file) => (
          <div key={file.path} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn(
              "text-[10px] font-semibold uppercase w-16",
              file.status === "added" && "text-green-600",
              file.status === "modified" && "text-amber-600",
              file.status === "deleted" && "text-red-600",
            )}>
              {file.status}
            </span>
            <span className="font-mono text-sm flex-1 truncate">{file.path}</span>
            <span className="text-xs text-green-600">+{file.additions}</span>
            <span className="text-xs text-red-600">-{file.deletions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Diff Tab ──────────────────────────────────────────────────────────

function DiffTab({ run, useMock }: { run: any; useMock: boolean }) {
  const diffContent = useMock ? MOCK_DIFF : null;
  const diffArtifact = run.artifacts?.find((a: any) => a.type === "diff");

  if (!useMock && !diffArtifact) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No diff data for this run. Toggle "Mock data" to preview.
        </p>
      </Card>
    );
  }

  const rawDiff = useMock
    ? diffContent
    : diffArtifact?.metadata?.patch || `${diffArtifact?.metadata?.files_changed ?? 0} files changed, ${diffArtifact?.metadata?.insertions ?? 0} insertions(+), ${diffArtifact?.metadata?.deletions ?? 0} deletions(-)`;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed max-h-[700px] overflow-y-auto bg-[#1C1B18] text-[#EEEDEA]">
        {(rawDiff ?? "").split("\n").map((line: string, i: number) => (
          <div
            key={i}
            className={cn(
              "px-2 -mx-2",
              line.startsWith("+") && !line.startsWith("+++") && "bg-green-900/20 text-green-300",
              line.startsWith("-") && !line.startsWith("---") && "bg-red-900/20 text-red-300",
              line.startsWith("@@") && "text-cyan-400",
              line.startsWith("diff ") && "text-amber-400 font-semibold mt-4 first:mt-0",
            )}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

// ── Artifacts Tab ─────────────────────────────────────────────────────

function ArtifactsTab({ run }: { run: any }) {
  if (!run.artifacts?.length) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">No artifacts collected.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {run.artifacts.map((artifact: any) => (
        <Card key={artifact.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="slate" className="text-[10px] capitalize">
                {artifact.type}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {artifact.storageKey.split("/").pop()}
              </span>
            </div>
            <span className="text-muted-foreground text-xs">
              {new Date(artifact.createdAt).toLocaleTimeString()}
            </span>
          </div>
          {artifact.metadata && Object.keys(artifact.metadata).length > 0 && (
            <div className="mt-3 rounded bg-muted/50 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(artifact.metadata).map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key.replace(/_/g, " ")}:</span>{" "}
                    <span className="font-medium">{typeof value === "string" && value.length > 100 ? value.slice(0, 100) + "..." : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
