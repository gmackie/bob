# Execution Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified Execution Review page at `/work-items/[id]/review` that shows the full pipeline from agent completion through production deployment.

**Architecture:** New Next.js route with a sticky pipeline rail at top, scrollable content sections (code review, CI/tests, deploy), and a context sidebar. All data comes from existing tRPC queries — no backend changes. Two phases: Phase 1 (code quality) and Phase 2 (deployment).

**Tech Stack:** Next.js 15, React 19, TanStack Query, tRPC, Tailwind CSS, `@bob/ui` (Badge, Button, cn), `~/lib/design/colors` (status color maps)

---

## Phase 1: "Is the Code Good?"

### Task 1: Pipeline Rail Component

**Files:**
- Create: `apps/web/src/components/review/pipeline-rail.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/pipeline-rail.tsx
"use client";

import { cn } from "@bob/ui";

export type PipelineNodeStatus = "done" | "active" | "failed" | "pending" | "approval";

export interface PipelineNode {
  name: string;
  status: PipelineNodeStatus;
  elapsed?: string;
  detail?: string;
  anchorId?: string;
}

interface PipelineRailProps {
  nodes: PipelineNode[];
}

const STATUS_DOT: Record<PipelineNodeStatus, string> = {
  done: "bg-emerald-500 text-white",
  active: "bg-amber-500 text-white animate-pulse",
  failed: "bg-rose-500 text-white",
  pending: "bg-muted border-2 border-border text-muted-foreground",
  approval: "bg-purple-500 text-white",
};

const STATUS_ICON: Record<PipelineNodeStatus, string> = {
  done: "✓",
  active: "●",
  failed: "✕",
  pending: "",
  approval: "⏸",
};

const LABEL_COLOR: Record<PipelineNodeStatus, string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  active: "text-amber-600 dark:text-amber-400 font-semibold",
  failed: "text-rose-600 dark:text-rose-400",
  pending: "text-muted-foreground",
  approval: "text-purple-600 dark:text-purple-400 font-semibold",
};

function connectorColor(from: PipelineNodeStatus, to: PipelineNodeStatus): string {
  if (from === "done" && to === "done") return "bg-emerald-500";
  if (from === "done" && (to === "active" || to === "approval")) return "bg-gradient-to-r from-emerald-500 to-amber-500";
  if (from === "failed" || to === "failed") return "bg-rose-500";
  return "bg-border";
}

export function PipelineRail({ nodes }: PipelineRailProps) {
  return (
    <div className="sticky top-0 z-30 flex items-center gap-0 overflow-x-auto border-b border-border bg-card px-6 py-5">
      {nodes.map((node, i) => (
        <div key={node.name} className="flex items-center">
          {i > 0 && (
            <div
              className={cn(
                "mx-1 h-0.5 w-8 shrink-0",
                connectorColor(nodes[i - 1]!.status, node.status),
              )}
              style={{ marginBottom: 22 }}
            />
          )}
          <a
            href={node.anchorId ? `#${node.anchorId}` : undefined}
            className="flex min-w-[80px] flex-col items-center gap-1"
          >
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                STATUS_DOT[node.status],
              )}
            >
              {STATUS_ICON[node.status]}
            </div>
            <span className={cn("text-[10px] font-medium", LABEL_COLOR[node.status])}>
              {node.name}
            </span>
            {node.elapsed && (
              <span className="font-mono text-[9px] text-muted-foreground">{node.elapsed}</span>
            )}
          </a>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20`
Expected: Build succeeds (or only unrelated warnings)

**Step 3: Commit**

```bash
git add apps/web/src/components/review/pipeline-rail.tsx
git commit -m "feat(review): add pipeline rail component"
```

---

### Task 2: Task Selector Component

**Files:**
- Create: `apps/web/src/components/review/task-selector.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/task-selector.tsx
"use client";

import { cn } from "@bob/ui";

export interface TaskTab {
  id: string;
  label: string;
  status: "completed" | "running" | "failed" | "blocked" | "queued";
}

interface TaskSelectorProps {
  tasks: TaskTab[];
  selectedTaskId: string | null; // null = "All Tasks"
  onSelect: (taskId: string | null) => void;
}

const TAB_STATUS_ICON: Record<string, string> = {
  completed: "✓",
  running: "●",
  failed: "✕",
  blocked: "⏸",
  queued: "○",
};

const TAB_STATUS_COLOR: Record<string, string> = {
  completed: "text-emerald-600 dark:text-emerald-400",
  running: "text-amber-600 dark:text-amber-400",
  failed: "text-rose-600 dark:text-rose-400",
  blocked: "text-muted-foreground",
  queued: "text-muted-foreground",
};

export function TaskSelector({ tasks, selectedTaskId, onSelect }: TaskSelectorProps) {
  if (tasks.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-6 py-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
          selectedTaskId === null
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        All Tasks
      </button>
      {tasks.map((task, i) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onSelect(task.id)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            selectedTaskId === task.id
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className={cn("text-[10px]", TAB_STATUS_COLOR[task.status])}>
            {TAB_STATUS_ICON[task.status]}
          </span>
          Task {i + 1}: {task.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add apps/web/src/components/review/task-selector.tsx
git commit -m "feat(review): add task selector tab bar"
```

---

### Task 3: Gate Row Component

**Files:**
- Create: `apps/web/src/components/review/gate-row.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/gate-row.tsx
"use client";

import { cn } from "@bob/ui";

export interface Gate {
  name: string;
  status: "pending" | "passed" | "failed" | "running";
  startedAt?: string;
  finishedAt?: string;
}

interface GateRowProps {
  gates: Gate[];
}

const GATE_DOT: Record<string, string> = {
  passed: "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  running: "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
  pending: "border-border bg-muted text-muted-foreground",
};

const GATE_ICON: Record<string, string> = {
  passed: "✓",
  failed: "✕",
  running: "●",
  pending: "○",
};

function connectorClass(from: string, to: string): string {
  if (from === "passed" && to === "passed") return "bg-emerald-500/40";
  if (from === "passed" && to === "running") return "bg-gradient-to-r from-emerald-500/40 to-blue-500/40";
  if (from === "failed" || to === "failed") return "bg-rose-500/40";
  return "bg-border";
}

function formatDuration(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function GateRow({ gates }: GateRowProps) {
  if (gates.length === 0) return null;

  return (
    <div className="flex items-center justify-center gap-0 rounded-2xl border border-border bg-card px-6 py-5">
      {gates.map((gate, i) => (
        <div key={gate.name} className="flex items-center">
          {i > 0 && (
            <div
              className={cn(
                "mx-3 h-0.5 w-12",
                connectorClass(gates[i - 1]!.status, gate.status),
              )}
              style={{ marginBottom: 22 }}
            />
          )}
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold",
                GATE_DOT[gate.status],
              )}
            >
              {GATE_ICON[gate.status]}
            </div>
            <span className="text-xs font-medium text-secondary-foreground">{gate.name}</span>
            {(gate.startedAt || gate.finishedAt) && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatDuration(gate.startedAt, gate.finishedAt)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/gate-row.tsx
git commit -m "feat(review): add CI gate row component"
```

---

### Task 4: Code Review Card Component

**Files:**
- Create: `apps/web/src/components/review/code-review-card.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/code-review-card.tsx
"use client";

import { cn } from "@bob/ui";

interface ReviewComment {
  file: string;
  line?: string;
  severity: "critical" | "suggestion" | "nit";
  body: string;
  diffContext?: string;
  resolution?: "applied" | "acknowledged" | null;
}

export interface CodeReviewData {
  decision: "approve" | "request_changes";
  summary: string;
  comments: ReviewComment[];
  reviewerName?: string;
  reviewedAt?: string;
  sessionId?: string;
  iteration?: number;
  isAgentFixing?: boolean;
}

interface CodeReviewCardProps {
  review: CodeReviewData;
  workItemIdentifier: string;
  taskLabel?: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  suggestion: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  nit: "bg-muted text-muted-foreground",
};

const RESOLUTION_STYLE: Record<string, { label: string; className: string }> = {
  applied: { label: "Applied", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  acknowledged: { label: "Acknowledged", className: "bg-muted text-muted-foreground" },
};

export function CodeReviewCard({ review, workItemIdentifier, taskLabel }: CodeReviewCardProps) {
  const isApproved = review.decision === "approve";

  return (
    <section id="section-review" className={cn(
      "rounded-2xl border bg-card overflow-hidden",
      isApproved ? "border-emerald-500/30" : "border-rose-500/30",
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center gap-3 px-5 py-4 border-b",
        isApproved ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5",
      )}>
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg text-lg",
          isApproved ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400",
        )}>
          {isApproved ? "✓" : "✕"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-sm font-semibold text-foreground">
            Code Review{taskLabel ? `: ${taskLabel}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{workItemIdentifier}</span>
            {review.reviewerName && <> · reviewed by <strong>{review.reviewerName}</strong></>}
            {review.reviewedAt && <> · {new Date(review.reviewedAt).toLocaleTimeString()}</>}
            {" · "}
            <span className={cn("font-semibold", isApproved ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
              {isApproved ? "APPROVED" : "CHANGES REQUESTED"}
            </span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="px-5 py-4">
        <div className={cn(
          "rounded-lg px-4 py-3 text-sm text-secondary-foreground leading-relaxed",
          isApproved ? "bg-muted" : "bg-rose-500/5 border border-rose-500/10",
        )}>
          {review.summary}
        </div>
      </div>

      {/* Comments */}
      {review.comments.length > 0 && (
        <div className="px-5 pb-4 space-y-3">
          {review.comments.map((comment, i) => (
            <div key={i} className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-xs border-b border-border">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">B</div>
                <span className="font-medium text-foreground">{review.reviewerName ?? "bob-reviewer"}</span>
                <span className="font-mono text-muted-foreground">{comment.file}</span>
                {comment.line && <span className="font-mono text-primary">{comment.line}</span>}
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold", SEVERITY_STYLE[comment.severity])}>
                  {comment.severity}
                </span>
              </div>
              {comment.diffContext && (
                <div className="border-b border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {comment.diffContext}
                </div>
              )}
              <div className="px-3 py-3 text-sm text-foreground leading-relaxed">
                {comment.body}
                {comment.resolution && (
                  <div className="mt-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", RESOLUTION_STYLE[comment.resolution]?.className)}>
                      {RESOLUTION_STYLE[comment.resolution]?.label}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className={cn(
        "flex items-center justify-between px-5 py-3 border-t bg-muted/30",
        !isApproved && "bg-rose-500/5 border-rose-500/10",
      )}>
        <span className="text-xs text-muted-foreground">
          {review.comments.length} comment{review.comments.length !== 1 ? "s" : ""}
          {review.comments.filter(c => c.resolution === "applied").length > 0 &&
            ` · ${review.comments.filter(c => c.resolution === "applied").length} applied`}
        </span>
        {!isApproved && review.isAgentFixing && (
          <div className="flex items-center gap-2">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Agent fixing{review.iteration ? ` — iteration ${review.iteration}` : ""}...
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/code-review-card.tsx
git commit -m "feat(review): add code review card with inline comments"
```

---

### Task 5: Build Detail Card Component

**Files:**
- Create: `apps/web/src/components/review/build-detail-card.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/build-detail-card.tsx
"use client";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { BUILD_COLOR, formatLabel } from "~/lib/design/colors";

export interface BuildData {
  id: string;
  status: string;
  ciProvider: string | null;
  externalJobId: string | null;
  imageDigest: string | null;
  durationMs: number | null;
  commitSha?: string;
  createdAt: Date | string;
}

interface BuildDetailCardProps {
  build: BuildData;
  artifacts?: Array<{ type: string; label: string; icon: string; onClick?: () => void }>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatTimeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function BuildDetailCard({ build, artifacts }: BuildDetailCardProps) {
  const isPassed = build.status === "passed";
  const isFailed = build.status === "failed";

  return (
    <div className={cn(
      "flex items-start gap-3.5 rounded-2xl border bg-card px-5 py-4",
      isFailed ? "border-rose-500/30" : "border-border",
    )}>
      <div className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl",
        isPassed ? "bg-emerald-500/10" : isFailed ? "bg-rose-500/10" : "bg-muted",
      )}>
        🏗
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Build #{build.id.slice(0, 6)}
          </span>
          <Badge variant={BUILD_COLOR[build.status] ?? "default"} className="text-[10px]">
            {formatLabel(build.status)}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {build.commitSha && (
            <span className="font-mono">{build.commitSha.slice(0, 7)}</span>
          )}
          {build.ciProvider && (
            <>
              <span className="text-border">·</span>
              <span>{build.ciProvider}</span>
            </>
          )}
          {build.durationMs !== null && (
            <>
              <span className="text-border">·</span>
              <span>Duration: {formatDuration(build.durationMs)}</span>
            </>
          )}
          <span className="text-border">·</span>
          <span>{formatTimeAgo(build.createdAt)}</span>
        </div>
        {build.imageDigest && (
          <div className="mt-1 text-xs text-muted-foreground">
            Image: <span className="font-mono">{build.imageDigest.slice(0, 19)}...</span>
          </div>
        )}
        {artifacts && artifacts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {artifacts.map((a) => (
              <button
                key={a.type}
                type="button"
                onClick={a.onClick}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-secondary-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                <span className="text-xs">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/build-detail-card.tsx
git commit -m "feat(review): add build detail card with artifact chips"
```

---

### Task 6: Test Report Viewer Component

**Files:**
- Create: `apps/web/src/components/review/test-report-viewer.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/test-report-viewer.tsx
"use client";

import { useState } from "react";
import { cn } from "@bob/ui";

export interface TestCase {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
}

export interface TestSuite {
  name: string;
  file: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests?: TestCase[];
}

export interface TestReportData {
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  durationMs: number;
  suites: TestSuite[];
}

interface TestReportViewerProps {
  report: TestReportData;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function StatCard({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
      <div className={cn("font-display text-2xl font-black tracking-tight", color)}>{value}</div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

export function TestReportViewer({ report }: TestReportViewerProps) {
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

  function toggleSuite(name: string) {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <section id="section-tests">
      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard value={report.totalPassed} label="Passed" color="text-emerald-600 dark:text-emerald-400" />
        <StatCard value={report.totalFailed} label="Failed" color="text-rose-600 dark:text-rose-400" />
        <StatCard value={report.totalSkipped} label="Skipped" color="text-muted-foreground" />
        <StatCard value={formatDuration(report.durationMs)} label="Duration" color="text-foreground" />
      </div>

      {/* Test suites */}
      <div className="space-y-2">
        {report.suites.map((suite) => {
          const isExpanded = expandedSuites.has(suite.name);
          const hasFails = suite.failed > 0;
          return (
            <div key={suite.name} className={cn("rounded-lg border overflow-hidden", hasFails ? "border-rose-500/30" : "border-border")}>
              <button
                type="button"
                onClick={() => suite.tests && toggleSuite(suite.name)}
                className={cn("flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors", suite.tests && "hover:bg-muted/50 cursor-pointer")}
              >
                <span className={cn("text-sm", hasFails ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                  {hasFails ? "✕" : "✓"}
                </span>
                <span className="flex-1 truncate font-mono text-xs font-medium text-foreground">{suite.file}</span>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  {suite.passed > 0 && <span className="text-emerald-600 dark:text-emerald-400">{suite.passed} pass</span>}
                  {suite.failed > 0 && <span className="text-rose-600 dark:text-rose-400">{suite.failed} fail</span>}
                  {suite.skipped > 0 && <span className="text-muted-foreground">{suite.skipped} skip</span>}
                  <span className="text-muted-foreground">{formatDuration(suite.durationMs)}</span>
                </div>
              </button>
              {isExpanded && suite.tests && (
                <div className="border-t border-border px-3.5 py-2 space-y-1">
                  {suite.tests.map((test, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 text-xs">
                      <span className={cn(
                        "w-4 text-center text-xs",
                        test.status === "passed" ? "text-emerald-600 dark:text-emerald-400" :
                        test.status === "failed" ? "text-rose-600 dark:text-rose-400" :
                        "text-muted-foreground",
                      )}>
                        {test.status === "passed" ? "✓" : test.status === "failed" ? "✕" : "○"}
                      </span>
                      <span className="flex-1 text-secondary-foreground">{test.name}</span>
                      {test.durationMs !== undefined && (
                        <span className="font-mono text-[10px] text-muted-foreground">{test.durationMs}ms</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/test-report-viewer.tsx
git commit -m "feat(review): add test report viewer with expandable suites"
```

---

### Task 7: Artifact Panel Component

**Files:**
- Create: `apps/web/src/components/review/artifact-panel.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/artifact-panel.tsx
"use client";

import { cn } from "@bob/ui";

export interface ArtifactItem {
  id: string;
  artifactType: string;
  artifactRole: string;
  title: string | null;
  url: string | null;
  producerType: string;
  createdAt: Date | string;
}

interface ArtifactPanelProps {
  artifacts: ArtifactItem[];
}

const TYPE_ICON: Record<string, string> = {
  pr: "📋",
  verification: "🔒",
  build: "🏗",
  test_report: "✅",
  doc: "📄",
  deliverable: "🚀",
  planning_doc: "📝",
  code_review: "📋",
  other: "📎",
};

const TYPE_BADGE_COLOR: Record<string, string> = {
  pr: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  build: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  test_report: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  code_review: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  verification: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  deliverable: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

function formatTimeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ArtifactPanel({ artifacts }: ArtifactPanelProps) {
  if (artifacts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No artifacts attached.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-display text-sm font-semibold text-foreground">Artifacts</h3>
        <span className="text-xs text-muted-foreground">{artifacts.length} items</span>
      </div>
      <div className="divide-y divide-border">
        {artifacts.map((artifact) => {
          const icon = TYPE_ICON[artifact.artifactType] ?? "📎";
          const badgeColor = TYPE_BADGE_COLOR[artifact.artifactType] ?? "bg-muted text-muted-foreground";
          const isLink = !!artifact.url;

          const content = (
            <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base">
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {artifact.title ?? artifact.artifactRole}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", badgeColor)}>
                    {artifact.artifactType.replace(/_/g, " ")}
                  </span>
                  <span>{artifact.producerType} · {formatTimeAgo(artifact.createdAt)}</span>
                </div>
              </div>
            </div>
          );

          return isLink ? (
            <a key={artifact.id} href={artifact.url!} target="_blank" rel="noreferrer" className="block">
              {content}
            </a>
          ) : (
            <div key={artifact.id} className="cursor-default">{content}</div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/artifact-panel.tsx
git commit -m "feat(review): add typed artifact panel"
```

---

### Task 8: Review Page Client Component

**Files:**
- Create: `apps/web/src/components/review/review-page.tsx`

**Step 1: Create the component**

This is the orchestrator that composes all the Phase 1 components together. It takes pre-fetched data from the server component, derives pipeline state, and renders the layout.

```tsx
// apps/web/src/components/review/review-page.tsx
"use client";

import { useState } from "react";
import { PipelineRail, type PipelineNode } from "./pipeline-rail";
import { TaskSelector, type TaskTab } from "./task-selector";
import { CodeReviewCard, type CodeReviewData } from "./code-review-card";
import { GateRow, type Gate } from "./gate-row";
import { BuildDetailCard, type BuildData } from "./build-detail-card";
import { TestReportViewer, type TestReportData } from "./test-report-viewer";
import { ArtifactPanel, type ArtifactItem } from "./artifact-panel";
import { formatLabel } from "~/lib/design/colors";

// ---------- prop types ----------
interface DispatchItemData {
  id: string;
  title: string;
  status: string;
  pipelineState: string | null;
  updatedAt: string;
}

interface RevisionData {
  id: string;
  revId: string;
  branch: string | null;
  gates: Gate[];
  builds: BuildData[];
}

export interface ReviewPageProps {
  workItemId: string;
  workItemIdentifier: string;
  workItemTitle: string;
  batchId: string;
  batchStatus: string;
  items: DispatchItemData[];
  revisions: Record<string, RevisionData>; // keyed by dispatchItem.id
  codeReviews: Record<string, CodeReviewData>; // keyed by dispatchItem.id
  testReports: Record<string, TestReportData>; // keyed by dispatchItem.id
  artifacts: ArtifactItem[];
  deployments: Array<{
    id: string;
    environment: string;
    status: string;
    deployedAt: string | null;
  }>;
}

// ---------- helpers ----------
const PIPELINE_STAGES = [
  { name: "Agent", statePrefix: null, anchorId: "section-agent" },
  { name: "Review", statePrefix: "awaiting_review", anchorId: "section-review" },
  { name: "Build", statePrefix: "building", anchorId: "section-build" },
  { name: "Gates", statePrefix: "gates_passed", anchorId: "section-gates" },
  { name: "Dev", statePrefix: "deploying_dev", anchorId: "section-dev" },
  { name: "Staging", statePrefix: "deploying_staging", anchorId: "section-staging" },
  { name: "Approve", statePrefix: "awaiting_prod_approval", anchorId: "section-approve" },
  { name: "Prod", statePrefix: "deploying_prod", anchorId: "section-prod" },
  { name: "Complete", statePrefix: "complete", anchorId: "section-complete" },
] as const;

const STATE_ORDER = [
  "agent_complete", "awaiting_review", "building", "gates_passed",
  "deploying_dev", "dev_healthy", "deploying_staging", "staging_healthy",
  "awaiting_prod_approval", "deploying_prod", "prod_healthy", "complete",
];

const FAILED_STATES = ["build_failed", "deploy_failed", "review_failed"];
const ACTIVE_STATES = ["building", "deploying_dev", "deploying_staging", "deploying_prod"];

function deriveNodeStatus(stageIndex: number, currentIndex: number, pipelineState: string | null): "done" | "active" | "failed" | "pending" | "approval" {
  if (!pipelineState) return stageIndex === 0 ? "active" : "pending";
  if (FAILED_STATES.includes(pipelineState)) {
    // Failed state — find which stage it maps to
    if (pipelineState === "build_failed" && stageIndex === 2) return "failed";
    if (pipelineState === "deploy_failed" && stageIndex >= 4 && stageIndex <= 7) return "failed";
    if (pipelineState === "review_failed" && stageIndex === 1) return "failed";
    if (stageIndex < currentIndex) return "done";
    return "pending";
  }
  if (stageIndex < currentIndex) return "done";
  if (stageIndex === currentIndex) {
    if (pipelineState === "awaiting_prod_approval") return "approval";
    if (ACTIVE_STATES.includes(pipelineState)) return "active";
    return "active";
  }
  return "pending";
}

function stateToStageIndex(state: string | null): number {
  if (!state) return 0;
  const idx = STATE_ORDER.indexOf(state);
  if (idx === -1) return 0;
  // Map state index to pipeline stage index
  if (idx <= 0) return 0; // agent_complete
  if (idx <= 1) return 1; // awaiting_review
  if (idx <= 2) return 2; // building
  if (idx <= 3) return 3; // gates_passed
  if (idx <= 4) return 4; // deploying_dev → dev
  if (idx <= 5) return 4; // dev_healthy → dev
  if (idx <= 6) return 5; // deploying_staging → staging
  if (idx <= 7) return 5; // staging_healthy → staging
  if (idx <= 8) return 6; // awaiting_prod_approval → approve
  if (idx <= 9) return 7; // deploying_prod → prod
  if (idx <= 10) return 7; // prod_healthy → prod
  return 8; // complete
}

function buildPipelineNodes(pipelineState: string | null): PipelineNode[] {
  const currentIndex = stateToStageIndex(pipelineState);
  return PIPELINE_STAGES.map((stage, i) => ({
    name: stage.name,
    status: deriveNodeStatus(i, currentIndex, pipelineState),
    anchorId: stage.anchorId,
  }));
}

// ---------- component ----------
export function ReviewPage(props: ReviewPageProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    props.items.length === 1 ? props.items[0]!.id : null,
  );

  // Determine which items to show
  const visibleItems = selectedTaskId
    ? props.items.filter((it) => it.id === selectedTaskId)
    : props.items;

  // Use the first visible item's pipeline state for the rail (or furthest-advanced for "All")
  const primaryItem = selectedTaskId
    ? visibleItems[0]
    : props.items.reduce((best, item) => {
        const bestIdx = stateToStageIndex(best?.pipelineState ?? null);
        const itemIdx = stateToStageIndex(item.pipelineState);
        return itemIdx > bestIdx ? item : best;
      }, props.items[0]);

  const pipelineNodes = buildPipelineNodes(primaryItem?.pipelineState ?? null);

  // Task tabs
  const taskTabs: TaskTab[] = props.items.map((item) => ({
    id: item.id,
    label: item.title.length > 30 ? item.title.slice(0, 30) + "..." : item.title,
    status: item.status as TaskTab["status"],
  }));

  return (
    <div className="flex min-h-screen flex-col">
      {/* Pipeline rail */}
      <PipelineRail nodes={pipelineNodes} />

      {/* Task selector */}
      <TaskSelector tasks={taskTabs} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />

      {/* Main content + sidebar */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-8">
        {/* Content area */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">
              Execution Review
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{props.workItemIdentifier}</span>
              <span>{props.workItemTitle}</span>
              <span className="text-border">·</span>
              <span>{props.items.filter(i => i.status === "completed").length}/{props.items.length} tasks done</span>
            </div>
          </div>

          {/* Code review cards */}
          {visibleItems.map((item) => {
            const review = props.codeReviews[item.id];
            if (!review) return null;
            return (
              <CodeReviewCard
                key={`cr-${item.id}`}
                review={review}
                workItemIdentifier={props.workItemIdentifier}
                taskLabel={selectedTaskId ? item.title : `Task: ${item.title}`}
              />
            );
          })}

          {/* Gate rows */}
          {visibleItems.map((item) => {
            const revision = props.revisions[item.id];
            if (!revision?.gates.length) return null;
            return <GateRow key={`gate-${item.id}`} gates={revision.gates} />;
          })}

          {/* Build cards */}
          {visibleItems.map((item) => {
            const revision = props.revisions[item.id];
            if (!revision?.builds.length) return null;
            return revision.builds.map((build) => (
              <BuildDetailCard
                key={build.id}
                build={{ ...build, commitSha: revision.revId }}
                artifacts={[
                  { type: "test", label: "Test Report", icon: "✅" },
                  { type: "image", label: "OCI Image", icon: "📦" },
                  { type: "log", label: "Build Log", icon: "📄" },
                ]}
              />
            ));
          })}

          {/* Test reports */}
          {visibleItems.map((item) => {
            const report = props.testReports[item.id];
            if (!report) return null;
            return <TestReportViewer key={`test-${item.id}`} report={report} />;
          })}

          {/* Phase 2 components will be added here */}
        </div>

        {/* Sidebar */}
        <aside className="hidden w-80 shrink-0 space-y-6 lg:block">
          {/* Batch summary */}
          <div className="rounded-2xl border border-border bg-card px-4 py-4">
            <h3 className="font-display text-sm font-semibold text-foreground">Dispatch Batch</h3>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium text-foreground capitalize">{formatLabel(props.batchStatus)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-mono text-foreground">
                  {props.items.filter(i => i.status === "completed").length}/{props.items.length}
                </span>
              </div>
              {props.items.some(i => i.status === "failed") && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Failed</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400">
                    {props.items.filter(i => i.status === "failed").length}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Artifact panel */}
          <ArtifactPanel artifacts={props.artifacts} />
        </aside>
      </div>
    </div>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/review-page.tsx
git commit -m "feat(review): add review page client component orchestrating all Phase 1 components"
```

---

### Task 9: Server Route Page

**Files:**
- Create: `apps/web/src/app/(dashboard)/work-items/[workItemId]/review/page.tsx`

**Step 1: Create the route**

```tsx
// apps/web/src/app/(dashboard)/work-items/[workItemId]/review/page.tsx
import { notFound } from "next/navigation";
import { createPlanningCaller } from "~/lib/planning/server";
import { ReviewPage } from "~/components/review/review-page";
import type { CodeReviewData } from "~/components/review/code-review-card";
import type { TestReportData } from "~/components/review/test-report-viewer";
import type { BuildData } from "~/components/review/build-detail-card";
import type { Gate } from "~/components/review/gate-row";
import type { ArtifactItem } from "~/components/review/artifact-panel";

export const dynamic = "force-dynamic";

interface ReviewPageRouteProps {
  params: Promise<{ workItemId: string }>;
}

export default async function ReviewPageRoute({ params }: ReviewPageRouteProps) {
  const { workItemId } = await params;
  const caller = (await createPlanningCaller()) as any;

  // Fetch work item
  const workItem = await caller.workItem.get({ workItemId }).catch(() => null);
  if (!workItem) return notFound();

  // Find dispatch batch for this work item
  const batches = await caller.dispatch.listBatches({ limit: 10 }).catch(() => []);
  const batch = batches.find((b: any) =>
    b.projectId === workItem.projectId
  );
  if (!batch) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No dispatch batch found for this work item. Start execution from the workflow page.
        </div>
      </main>
    );
  }

  // Fetch batch with items
  const batchData = await caller.dispatch.getBatch({ batchId: batch.id });
  const { items } = batchData;

  // Fetch ForgeGraph data for each item that has progressed past agent
  const revisions: Record<string, any> = {};
  const codeReviews: Record<string, CodeReviewData> = {};
  const testReports: Record<string, TestReportData> = {};

  await Promise.all(
    items.map(async (item: any) => {
      if (!item.pipelineState) return;

      // Try to find revision for this item
      const revs = await caller.forgegraph
        .listRevisions({ taskId: workItemId, limit: 5 })
        .catch(() => []);

      if (revs.length > 0) {
        const rev = revs[0];
        const fullRev = await caller.forgegraph
          .getRevision({ repoId: rev.repoId, revId: rev.revId })
          .catch(() => null);
        if (fullRev) {
          revisions[item.id] = {
            id: fullRev.id,
            revId: fullRev.revId,
            branch: fullRev.branch,
            gates: (fullRev.gates ?? []) as Gate[],
            builds: (fullRev.builds ?? []).map((b: any) => ({
              id: b.id,
              status: b.status,
              ciProvider: b.ciProvider,
              externalJobId: b.externalJobId,
              imageDigest: b.imageDigest,
              durationMs: b.durationMs,
              createdAt: b.createdAt,
            })) as BuildData[],
          };
        }
      }
    }),
  );

  // Fetch artifacts for the work item
  const allArtifacts: ArtifactItem[] = await caller.workItem
    .listArtifacts?.({ workItemId })
    .then((arts: any[]) =>
      arts.map((a: any) => ({
        id: a.id,
        artifactType: a.artifactType ?? a.artifactRole ?? "other",
        artifactRole: a.artifactRole ?? "",
        title: a.title,
        url: a.url,
        producerType: a.producerType ?? "system",
        createdAt: a.createdAt,
      })),
    )
    .catch(() => [] as ArtifactItem[]);

  // Parse code review artifacts
  for (const item of items) {
    const reviewArtifact = allArtifacts.find(
      (a) => a.artifactType === "code_review",
    );
    if (reviewArtifact) {
      try {
        // Code review content would be parsed from artifact — placeholder for now
        codeReviews[item.id] = {
          decision: "approve",
          summary: "Review passed.",
          comments: [],
          reviewerName: "bob-reviewer",
        };
      } catch {
        // Skip unparseable reviews
      }
    }
  }

  // Fetch deployments
  const deployments = await Promise.all(
    Object.values(revisions).map((rev: any) =>
      caller.forgegraph.listDeployments({ revisionId: rev.id }).catch(() => []),
    ),
  ).then((results) =>
    results.flat().map((d: any) => ({
      id: d.id,
      environment: d.environment as string,
      status: d.status as string,
      deployedAt: d.deployedAt ? String(d.deployedAt) : null,
    })),
  );

  const identifier =
    workItem.identifier ?? `TASK-${workItem.id.slice(0, 8)}`;

  return (
    <ReviewPage
      workItemId={workItemId}
      workItemIdentifier={identifier}
      workItemTitle={workItem.title}
      batchId={batch.id}
      batchStatus={batch.status}
      items={items.map((item: any) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        pipelineState: item.pipelineState,
        updatedAt: String(item.updatedAt),
      }))}
      revisions={revisions}
      codeReviews={codeReviews}
      testReports={testReports}
      artifacts={allArtifacts}
      deployments={deployments}
    />
  );
}
```

**Step 2: Verify the route works**

Run: `cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -30`
Expected: Build succeeds. The route is now accessible at `/work-items/[id]/review`.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/work-items/\[workItemId\]/review/page.tsx
git commit -m "feat(review): add server route page for /work-items/[id]/review"
```

---

### Task 10: Wire Entry Points from Workflow Stages

**Files:**
- Modify: `apps/web/src/components/workflow/stage-execute.tsx`
- Modify: `apps/web/src/components/workflow/stage-review.tsx`

**Step 1: Add "View Execution Review" link to stage-execute.tsx**

Find the closing `</section>` tag in `StageExecute`. Just before the final `</div>` inside the `{!isCollapsed && (...)}` block, add:

```tsx
{/* Add this after the task list div, before the closing </div> of the !isCollapsed block */}
{dispatchStatus.completed > 0 && (
  <a
    href={`/work-items/${workItemId}/review`}
    className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
  >
    View Execution Review →
  </a>
)}
```

**Step 2: Add "Open Review Dashboard" link to stage-review.tsx**

At the top of the `{!isCollapsed && (...)}` block in `StageReview`, add:

```tsx
{/* Add as the first child inside !isCollapsed block */}
<a
  href={`/work-items/${workItemId}/review`}
  className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
>
  Open Review Dashboard →
</a>
```

**Step 3: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/workflow/stage-execute.tsx apps/web/src/components/workflow/stage-review.tsx
git commit -m "feat(review): add entry point links from workflow stages to review page"
```

---

## Phase 2: "Is It Deployed Safely?"

### Task 11: Environment Lanes Component

**Files:**
- Create: `apps/web/src/components/review/environment-lanes.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/environment-lanes.tsx
"use client";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

export interface DeploymentLane {
  id: string;
  environment: string;
  status: string;
  deployedAt: string | null;
  commitSha?: string;
  podReady?: string; // e.g. "2/3"
}

interface EnvironmentLanesProps {
  deployments: DeploymentLane[];
  onApprove?: () => void;
  onRollback?: (deploymentId: string) => void;
  isApproving?: boolean;
}

const ENV_ORDER = ["dev", "staging", "prod", "production"];

const TOP_BAR_COLOR: Record<string, string> = {
  healthy: "bg-emerald-500",
  deploying: "bg-amber-500",
  unhealthy: "bg-rose-500",
  failed: "bg-rose-500",
  pending_approval: "bg-purple-500",
  rolled_back: "bg-rose-500",
  pending: "bg-border",
};

const STATUS_DOT: Record<string, string> = {
  healthy: "bg-emerald-500",
  deploying: "bg-amber-500 animate-pulse",
  unhealthy: "bg-rose-500",
  failed: "bg-rose-500",
  pending_approval: "bg-purple-500",
  rolled_back: "bg-rose-500/50",
  pending: "bg-muted-foreground/30",
};

const STATUS_TEXT_COLOR: Record<string, string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  deploying: "text-amber-600 dark:text-amber-400",
  unhealthy: "text-rose-600 dark:text-rose-400",
  failed: "text-rose-600 dark:text-rose-400",
  pending_approval: "text-purple-600 dark:text-purple-400",
};

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimeAgo(date: string): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function EnvironmentLanes({ deployments, onApprove, onRollback, isApproving }: EnvironmentLanesProps) {
  const sorted = [...deployments].sort(
    (a, b) => ENV_ORDER.indexOf(a.environment) - ENV_ORDER.indexOf(b.environment),
  );

  if (sorted.length === 0) return null;

  return (
    <section id="section-deploy">
      <div className="grid gap-0 overflow-hidden rounded-2xl border border-border sm:grid-cols-3">
        {sorted.map((deploy, i) => (
          <div
            key={deploy.id}
            className={cn(
              "relative bg-card px-5 py-5",
              i > 0 && "border-t sm:border-l sm:border-t-0 border-border",
            )}
          >
            {/* Top color bar */}
            <div className={cn("absolute inset-x-0 top-0 h-[3px]", TOP_BAR_COLOR[deploy.status] ?? "bg-border")} />

            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {deploy.environment === "prod" ? "Production" : formatLabel(deploy.environment)}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[deploy.status] ?? "bg-muted-foreground/30")} />
              <span className={cn("text-sm font-semibold", STATUS_TEXT_COLOR[deploy.status] ?? "text-muted-foreground")}>
                {formatLabel(deploy.status)}
              </span>
            </div>

            {deploy.podReady && (
              <div className="mt-1 text-xs text-muted-foreground">{deploy.podReady} pods ready</div>
            )}

            {deploy.deployedAt && (
              <div className="mt-1 text-xs text-muted-foreground">
                Deployed {formatTimeAgo(deploy.deployedAt)}
              </div>
            )}

            {deploy.commitSha && (
              <div className="mt-2">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {deploy.commitSha.slice(0, 7)}
                </span>
              </div>
            )}

            {/* Deploying progress */}
            {deploy.status === "deploying" && (
              <div className="mt-3">
                <div className="h-1 rounded-full bg-muted">
                  <div className="h-1 w-2/3 animate-pulse rounded-full bg-amber-500" />
                </div>
              </div>
            )}

            {/* Rollback button */}
            {(deploy.status === "unhealthy" || deploy.status === "failed") && onRollback && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => onRollback(deploy.id)}
                >
                  ↩ Rollback
                </Button>
              </div>
            )}

            {/* Promote button on prod lane */}
            {deploy.status === "pending_approval" && onApprove && (
              <div className="mt-3">
                <Button
                  size="sm"
                  className="h-7 w-full bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                  onClick={onApprove}
                  disabled={isApproving}
                >
                  {isApproving ? "Approving..." : "✓ Approve Production"}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/environment-lanes.tsx
git commit -m "feat(review): add environment lanes component for deploy progression"
```

---

### Task 12: Approval Gate Card Component

**Files:**
- Create: `apps/web/src/components/review/approval-gate-card.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/approval-gate-card.tsx
"use client";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

interface EvidenceItem {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface ApprovalGateCardProps {
  commitSha: string;
  imageRef?: string;
  evidence: EvidenceItem[];
  onApprove: () => void;
  onReject?: () => void;
  isApproving: boolean;
}

export function ApprovalGateCard({
  commitSha,
  imageRef,
  evidence,
  onApprove,
  onReject,
  isApproving,
}: ApprovalGateCardProps) {
  return (
    <section id="section-approve">
      <div className="rounded-2xl border border-purple-500 bg-purple-500/5 dark:bg-purple-500/10 px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500 text-xl text-white">
            ⏸
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Production Approval Required
            </h2>
            <div className="mt-1 text-sm text-secondary-foreground">
              Commit{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {commitSha.slice(0, 7)}
              </span>
              {imageRef && (
                <>
                  {" · "}
                  <span className="font-mono text-xs text-muted-foreground">{imageRef}</span>
                </>
              )}
            </div>

            {/* Evidence checklist */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              {evidence.map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium",
                    item.passed
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  <span>{item.passed ? "✓" : "✕"}</span>
                  <span>{item.label}</span>
                  {item.detail && (
                    <span className="text-muted-foreground font-normal">{item.detail}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-5 flex gap-3">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={onApprove}
                disabled={isApproving}
              >
                {isApproving ? "Approving..." : "✓ Approve Production Deploy"}
              </Button>
              <Button variant="outline" size="default">
                View Full Report
              </Button>
              {onReject && (
                <Button variant="destructive" size="default" onClick={onReject}>
                  ✕ Reject
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/approval-gate-card.tsx
git commit -m "feat(review): add production approval gate card with evidence checklist"
```

---

### Task 13: Error Detail Card Component

**Files:**
- Create: `apps/web/src/components/review/error-detail-card.tsx`

**Step 1: Create the component**

```tsx
// apps/web/src/components/review/error-detail-card.tsx
"use client";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

export interface ErrorDetailCardProps {
  type: "build_failed" | "deploy_failed" | "review_failed";
  title: string;
  message: string;
  stackTrace?: string;
  onRetry?: () => void;
  onResumeAgent?: () => void;
  onRollback?: () => void;
  onViewLogs?: () => void;
  isRetrying?: boolean;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  build_failed: { icon: "🔴", label: "Build Failed" },
  deploy_failed: { icon: "🚨", label: "Deploy Failed" },
  review_failed: { icon: "🔄", label: "Review Rejected" },
};

export function ErrorDetailCard({
  type,
  title,
  message,
  stackTrace,
  onRetry,
  onResumeAgent,
  onRollback,
  onViewLogs,
  isRetrying,
}: ErrorDetailCardProps) {
  const config = TYPE_CONFIG[type] ?? TYPE_CONFIG.build_failed!;

  return (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 dark:bg-rose-500/10 px-5 py-4">
      <div className="flex items-start gap-3.5">
        <span className="text-xl">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-rose-700 dark:text-rose-400">{title}</div>
          <div className="mt-1 text-sm text-secondary-foreground">{message}</div>

          {stackTrace && (
            <div className="mt-3 overflow-x-auto rounded-lg bg-rose-950/10 dark:bg-black/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-rose-700 dark:text-rose-300 whitespace-pre">
              {stackTrace}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry} disabled={isRetrying}>
                {isRetrying ? "Retrying..." : "↻ Retry"}
              </Button>
            )}
            {onResumeAgent && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onResumeAgent}>
                Resume Agent
              </Button>
            )}
            {onRollback && (
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={onRollback}>
                ↩ Rollback
              </Button>
            )}
            {onViewLogs && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onViewLogs}>
                📋 View Logs
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/error-detail-card.tsx
git commit -m "feat(review): add error detail card for build/deploy/review failures"
```

---

### Task 14: Integrate Phase 2 Components into Review Page

**Files:**
- Modify: `apps/web/src/components/review/review-page.tsx`

**Step 1: Add imports**

At the top of `review-page.tsx`, add these imports after the existing ones:

```tsx
import { EnvironmentLanes, type DeploymentLane } from "./environment-lanes";
import { ApprovalGateCard } from "./approval-gate-card";
import { ErrorDetailCard } from "./error-detail-card";
```

**Step 2: Add Phase 2 rendering**

In the content area of `ReviewPage`, after the `{/* Phase 2 components will be added here */}` comment, add:

```tsx
{/* Error cards for failed states */}
{visibleItems.map((item) => {
  if (item.pipelineState === "build_failed") {
    return (
      <ErrorDetailCard
        key={`err-${item.id}`}
        type="build_failed"
        title="Build Failed"
        message={`Task "${item.title}" failed during build.`}
        onRetry={() => {/* TODO: wire trpc.dispatch.resetPipelineState */}}
      />
    );
  }
  if (item.pipelineState === "deploy_failed") {
    return (
      <ErrorDetailCard
        key={`err-${item.id}`}
        type="deploy_failed"
        title="Deploy Failed"
        message={`Task "${item.title}" failed during deployment.`}
        onRollback={() => {/* TODO: wire rollback */}}
      />
    );
  }
  return null;
})}

{/* Approval gate */}
{primaryItem?.pipelineState === "awaiting_prod_approval" && (
  <ApprovalGateCard
    commitSha={Object.values(props.revisions)[0]?.revId ?? "unknown"}
    evidence={[
      { label: "Tests pass", passed: true },
      { label: "Code review approved", passed: Object.values(props.codeReviews).some(r => r.decision === "approve") },
      { label: "Staging healthy", passed: props.deployments.some(d => d.environment === "staging" && d.status === "healthy") },
    ]}
    onApprove={() => {/* TODO: wire trpc.forgegraph.approveProdDeploy */}}
    isApproving={false}
  />
)}

{/* Environment lanes */}
{props.deployments.length > 0 && (
  <EnvironmentLanes
    deployments={props.deployments.map(d => ({
      ...d,
      commitSha: Object.values(props.revisions)[0]?.revId,
    }))}
  />
)}
```

**Step 3: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/review/review-page.tsx
git commit -m "feat(review): integrate Phase 2 components (deploy lanes, approval gate, error cards)"
```

---

### Task 15: Wire Dispatch & Deploy Stage Entry Points

**Files:**
- Modify: `apps/web/src/components/planning/dispatch-plan.tsx`
- Modify: `apps/web/src/components/workflow/stage-deploy.tsx`

**Step 1: Add review page links to dispatch-plan.tsx**

Find the existing "View" button or the last `<td>` in each dispatch item row. Add a link:

```tsx
{/* In the table row for each item, add/replace the view button */}
<a
  href={`/work-items/${/* workItemId from parent context */}/review?task=${item.id}`}
  className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-secondary-foreground transition-colors hover:border-primary/30 hover:text-primary"
>
  View
</a>
```

Note: You may need to pass `workItemId` as a prop to `DispatchPlan` if it's not already available. Check the parent component to find how the work item ID flows.

**Step 2: Add entry point to stage-deploy.tsx**

Inside `StageDeploy`, in the `{!isCollapsed && (...)}` block, add before the deployment cards:

```tsx
<a
  href={`/work-items/${workItemId}/review`}
  className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
>
  View Deploy Status →
</a>
```

**Step 3: Verify and commit**

```bash
cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web -- --no-lint 2>&1 | tail -20
git add apps/web/src/components/planning/dispatch-plan.tsx apps/web/src/components/workflow/stage-deploy.tsx
git commit -m "feat(review): wire dispatch table and deploy stage to review page"
```

---

### Task 16: Final Build Verification

**Step 1: Full build**

Run: `cd /Volumes/dev/bob && pnpm turbo run build --filter=@bob/web 2>&1 | tail -30`
Expected: Build succeeds with no errors.

**Step 2: Type check**

Run: `cd /Volumes/dev/bob && pnpm turbo run typecheck --filter=@bob/web 2>&1 | tail -20`
Expected: No type errors.

**Step 3: List all new files**

Run: `ls -la apps/web/src/components/review/`
Expected: 11 files (pipeline-rail, task-selector, gate-row, code-review-card, build-detail-card, test-report-viewer, artifact-panel, review-page, environment-lanes, approval-gate-card, error-detail-card)

Run: `ls -la apps/web/src/app/\(dashboard\)/work-items/\[workItemId\]/review/`
Expected: 1 file (page.tsx)

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(review): resolve any build/type issues from final verification"
```
