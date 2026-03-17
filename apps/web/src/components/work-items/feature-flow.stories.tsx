import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { Separator } from "@bob/ui/separator";

const meta: Meta = {
  title: "Lifecycle/Feature Flow",
};

export default meta;

/* ════════════════════════════════════════════════════════════════
   1. BRD — Requirements Document
   ════════════════════════════════════════════════════════════════ */

export const RequirementsDocument: StoryObj = {
  name: "1. Requirements (BRD)",
  render: () => (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
          EPIC-0040 <Badge variant="purple">Epic</Badge> <Badge variant="amber">In Progress</Badge>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
          Priority system for work items
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Full priority support across the platform — database, API, board UI, filtering, and sorting.
        </p>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium text-foreground">Requirements Progress</span>
          <span className="text-muted-foreground">7 / 12 complete</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: "58%" }} />
        </div>
      </div>

      {/* Requirements grouped by category */}
      <div className="space-y-6">
        {/* Data Layer */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Data Layer
          </h3>
          <div className="space-y-1">
            {[
              { req: "Add priority column to work_items table (enum: urgent, high, medium, low, none)", done: true, task: "WI-0041" },
              { req: "Default existing rows to 'none' priority", done: true, task: "WI-0041" },
              { req: "Add composite index on (project_id, priority) for board queries", done: true, task: "WI-0041" },
            ].map((r, i) => (
              <RequirementRow key={i} {...r} />
            ))}
          </div>
        </div>

        {/* API Layer */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            API Layer
          </h3>
          <div className="space-y-1">
            {[
              { req: "Accept priority field on workItem.create and workItem.update mutations", done: true, task: "WI-0042" },
              { req: "Include priority in workItem.list and workItem.get responses", done: true, task: "WI-0042" },
              { req: "Support priority filter param on workItem.list", done: false, task: "WI-0045", status: "backlog" },
              { req: "Validate priority enum values server-side", done: true, task: "WI-0042" },
            ].map((r, i) => (
              <RequirementRow key={i} {...r} />
            ))}
          </div>
        </div>

        {/* UI Layer */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            UI Layer
          </h3>
          <div className="space-y-1">
            {[
              { req: "PriorityBadge component with 5 color variants", done: true, task: "WI-0043" },
              { req: "Inline priority editing on work item detail view", done: false, task: "WI-0043", status: "in_progress" },
              { req: "Priority left-border indicators on kanban board cards", done: false, task: "WI-0044", status: "todo" },
              { req: "Priority column sorting in kanban columns", done: false, task: "WI-0044", status: "todo" },
              { req: "Priority filter in board filter bar", done: false, task: "WI-0045", status: "backlog" },
            ].map((r, i) => (
              <RequirementRow key={i} {...r} />
            ))}
          </div>
        </div>
      </div>
    </div>
  ),
};

function RequirementRow({ req, done, task, status }: {
  req: string; done: boolean; task: string; status?: string;
}) {
  const STATUS_COLOR: Record<string, "emerald" | "amber" | "blue" | "slate"> = {
    in_progress: "amber", todo: "blue", backlog: "slate",
  };
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm",
      done ? "opacity-70" : "bg-card border border-border",
    )}>
      <div className={cn(
        "mt-0.5 size-4 rounded border flex items-center justify-center shrink-0",
        done ? "border-emerald-500 bg-emerald-500/20" : "border-border",
      )}>
        {done && <span className="text-[10px] text-emerald-400">✓</span>}
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn("text-sm", done ? "line-through text-muted-foreground" : "text-foreground")}>{req}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[10px] text-muted-foreground">{task}</span>
        {!done && status && (
          <Badge variant={STATUS_COLOR[status] ?? "default"} className="text-[9px] px-1.5 py-0">
            {status.replace(/_/g, " ")}
          </Badge>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   2. AGENT PROGRESS — Working through requirements
   ════════════════════════════════════════════════════════════════ */

export const AgentProgress: StoryObj = {
  name: "2. Agent Progress",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">Agent Dispatch</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bob is working through the priority system requirements across 5 tasks.
          </p>
        </div>
        <Badge variant="blue" className="text-sm px-3 py-1">3 / 5 tasks complete</Badge>
      </div>

      {/* Active dispatch bar */}
      <div className="flex items-center gap-3 rounded-lg border border-blue-400/30 bg-blue-500/5 px-4 py-3">
        <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-sm">Dispatching: <strong>3</strong>/5 tasks complete</span>
        <span className="ml-auto text-xs text-muted-foreground">ETA: ~8 minutes remaining</span>
      </div>

      {/* Task execution timeline */}
      <div className="space-y-0">
        {[
          {
            id: "WI-0041", title: "Add priority column migration",
            status: "complete", duration: "2m 14s", reqs: 3, reqsDone: 3,
            agent: "bob-agent-1", branch: "feature/wi-0041",
            prStatus: "merged" as const,
          },
          {
            id: "WI-0042", title: "Update tRPC router for priority",
            status: "complete", duration: "3m 47s", reqs: 4, reqsDone: 3,
            agent: "bob-agent-2", branch: "feature/wi-0042",
            prStatus: "merged" as const,
          },
          {
            id: "WI-0043", title: "Priority badge component",
            status: "running", duration: "1m 32s", reqs: 2, reqsDone: 1,
            agent: "bob-agent-1", branch: "feature/wi-0043",
            prStatus: null,
          },
          {
            id: "WI-0044", title: "Board priority indicators",
            status: "queued", duration: null, reqs: 2, reqsDone: 0,
            agent: null, branch: null,
            prStatus: null,
          },
          {
            id: "WI-0045", title: "Priority filter bar",
            status: "queued", duration: null, reqs: 2, reqsDone: 0,
            agent: null, branch: null,
            prStatus: null,
          },
        ].map((task, i) => (
          <div key={task.id} className="flex gap-4">
            {/* Timeline line */}
            <div className="flex flex-col items-center w-8">
              <div className={cn(
                "size-3 rounded-full",
                task.status === "complete" ? "bg-emerald-400"
                  : task.status === "running" ? "bg-blue-400 animate-pulse"
                  : "bg-border",
              )} />
              {i < 4 && <div className="w-px flex-1 bg-border" />}
            </div>

            {/* Task card */}
            <div className={cn(
              "flex-1 rounded-xl border px-4 py-3 mb-3 transition",
              task.status === "running"
                ? "border-blue-400/30 bg-blue-500/5"
                : task.status === "complete"
                  ? "border-border bg-card"
                  : "border-border bg-secondary opacity-60",
            )}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
                  <span className="text-sm font-medium text-foreground">{task.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {task.prStatus === "merged" && <Badge variant="emerald" className="text-[9px]">PR merged</Badge>}
                  {task.status === "running" && <Badge variant="blue" className="text-[9px]">running</Badge>}
                  {task.status === "queued" && <Badge variant="slate" className="text-[9px]">queued</Badge>}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                {/* Requirements progress */}
                <div className="flex items-center gap-1.5">
                  <span>Reqs:</span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: task.reqs }).map((_, j) => (
                      <div key={j} className={cn(
                        "size-1.5 rounded-full",
                        j < task.reqsDone ? "bg-emerald-400" : "bg-border",
                      )} />
                    ))}
                  </div>
                  <span>{task.reqsDone}/{task.reqs}</span>
                </div>

                {task.duration && <span>{task.duration}</span>}
                {task.agent && <span className="font-mono">{task.agent}</span>}
                {task.branch && <span className="font-mono">{task.branch}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   3. TWO-TIER PR MODEL
   ════════════════════════════════════════════════════════════════ */

export const TwoTierPRModel: StoryObj = {
  name: "3. Two-Tier PR Model",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">PR Strategy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Two layers of PRs: task-level for CI validation, feature-level for merging to main.
        </p>
      </div>

      {/* Visual model */}
      <div className="rounded-2xl border border-border bg-card p-6">
        {/* Tier 1: Task PRs */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-400">Tier 1</div>
            <span className="text-sm font-medium text-foreground">Task PRs</span>
            <span className="text-xs text-muted-foreground">— every task gets a PR to validate CI</span>
          </div>

          <div className="grid grid-cols-3 gap-3 ml-6">
            {[
              { pr: "#11", task: "WI-0041", title: "Migration", status: "merged", checks: true },
              { pr: "#12", task: "WI-0042", title: "tRPC router", status: "merged", checks: true },
              { pr: "#13", task: "WI-0043", title: "Badge component", status: "open", checks: true },
            ].map((pr) => (
              <div key={pr.pr} className={cn(
                "rounded-xl border px-3 py-3 text-center",
                pr.status === "merged"
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-blue-500/20 bg-blue-500/5",
              )}>
                <div className="font-mono text-xs text-muted-foreground">{pr.pr}</div>
                <div className="mt-1 text-sm font-medium text-foreground">{pr.title}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">{pr.task}</div>
                <div className="mt-2 flex items-center justify-center gap-1">
                  <span className={cn(
                    "size-3 rounded-full flex items-center justify-center text-[8px]",
                    pr.checks ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400",
                  )}>✓</span>
                  <Badge variant={pr.status === "merged" ? "emerald" : "blue"} className="text-[9px]">{pr.status}</Badge>
                </div>
              </div>
            ))}
          </div>

          {/* Arrow down */}
          <div className="flex justify-center my-4">
            <div className="flex flex-col items-center gap-1">
              <div className="w-px h-4 bg-border" />
              <div className="text-xs text-muted-foreground">merge into feature branch</div>
              <div className="w-px h-4 bg-border" />
              <span className="text-muted-foreground">↓</span>
            </div>
          </div>
        </div>

        {/* Tier 2: Feature PR */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-full bg-primary/20 px-3 py-1 text-xs font-medium text-primary">Tier 2</div>
            <span className="text-sm font-medium text-foreground">Feature PR</span>
            <span className="text-xs text-muted-foreground">— combined into one PR for main</span>
          </div>

          <div className="ml-6 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-xs text-muted-foreground">#14</div>
                <div className="mt-1 text-sm font-medium text-foreground">feat: Priority system for work items</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  feature/epic-0040 → main · 3 tasks · +156 −12
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="amber" className="text-[10px]">awaiting review</Badge>
                <div className="flex items-center gap-1">
                  {["Lint", "Test", "Build"].map((check) => (
                    <span key={check} className="size-3 rounded-full bg-emerald-500/20 flex items-center justify-center text-[8px] text-emerald-400">✓</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Includes: WI-0041 (migration) + WI-0042 (router) + WI-0043 (badge) — squashed from 3 task PRs
            </div>
          </div>

          {/* Arrow to main */}
          <div className="flex justify-center mt-4">
            <div className="flex flex-col items-center gap-1">
              <span className="text-muted-foreground">↓</span>
              <div className="rounded-full bg-foreground px-4 py-1 text-xs font-medium text-background">main</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   4. FEATURE REVIEW — Final review before merge to main
   ════════════════════════════════════════════════════════════════ */

export const FeatureReview: StoryObj = {
  name: "4. Feature Review",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">#14</span>
          <span>·</span>
          <Badge variant="emerald">Open</Badge>
          <span>·</span>
          <span className="font-mono">feature/epic-0040 → main</span>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
          feat: Priority system for work items
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
          <span>bob opened 15m ago</span>
          <span>·</span>
          <span>8 files changed</span>
          <span>·</span>
          <span className="text-emerald-400">+156</span>
          <span className="text-rose-400">−12</span>
          <span>·</span>
          <span>3 tasks combined</span>
        </div>
      </div>

      {/* Requirements checklist in PR */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-3">Requirements Verification</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Auto-verified against the BRD for EPIC-0040. 10/12 requirements covered by this PR.
        </p>
        <div className="space-y-1.5">
          {[
            { req: "Priority column on work_items table", covered: true },
            { req: "Default existing rows to 'none'", covered: true },
            { req: "Composite index for board queries", covered: true },
            { req: "Create/update mutations accept priority", covered: true },
            { req: "List/get responses include priority", covered: true },
            { req: "Server-side enum validation", covered: true },
            { req: "PriorityBadge component", covered: true },
            { req: "Inline priority editing", covered: true },
            { req: "Board priority left-borders", covered: false, note: "WI-0044 — next PR" },
            { req: "Board priority sorting", covered: false, note: "WI-0044 — next PR" },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm px-2 py-1">
              <div className={cn(
                "size-4 rounded border flex items-center justify-center shrink-0",
                r.covered ? "border-emerald-500 bg-emerald-500/20" : "border-border",
              )}>
                {r.covered && <span className="text-[10px] text-emerald-400">✓</span>}
              </div>
              <span className={cn(r.covered ? "text-muted-foreground" : "text-foreground")}>{r.req}</span>
              {r.note && <span className="text-[10px] text-muted-foreground ml-auto">{r.note}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Included task PRs */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-3">Included Task PRs</h3>
        <div className="space-y-2">
          {[
            { pr: "#11", task: "WI-0041", title: "Add priority column migration", files: 2, adds: 34, dels: 0, tests: "38/38" },
            { pr: "#12", task: "WI-0042", title: "Update tRPC router for priority", files: 3, adds: 75, dels: 12, tests: "38/38" },
            { pr: "#13", task: "WI-0043", title: "Priority badge component", files: 3, adds: 47, dels: 0, tests: "38/38" },
          ].map((pr) => (
            <div key={pr.pr} className="flex items-center gap-3 rounded-lg border border-border bg-accent px-4 py-3">
              <span className="font-mono text-xs text-muted-foreground w-8">{pr.pr}</span>
              <span className="font-mono text-[10px] text-muted-foreground w-16">{pr.task}</span>
              <span className="flex-1 text-sm text-foreground">{pr.title}</span>
              <span className="text-xs text-muted-foreground">{pr.files} files</span>
              <span className="font-mono text-[10px] text-emerald-400">+{pr.adds}</span>
              {pr.dels > 0 && <span className="font-mono text-[10px] text-rose-400">−{pr.dels}</span>}
              <span className="size-3 rounded-full bg-emerald-500/20 flex items-center justify-center text-[8px] text-emerald-400">✓</span>
            </div>
          ))}
        </div>
      </div>

      {/* CI + Review */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-3">CI Pipeline</h3>
          <div className="space-y-2">
            {[
              { name: "Lint", time: "12s" },
              { name: "Type Check", time: "22s" },
              { name: "Unit Tests (38/38)", time: "47s" },
              { name: "Integration Tests", time: "1m 32s" },
              { name: "Build", time: "1m 8s" },
              { name: "Deploy Preview", time: "34s" },
            ].map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-sm">
                <span className="size-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400">✓</span>
                <span className="flex-1 text-foreground">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.time}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-3">Review Status</h3>
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="size-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400">✓</span>
                <span className="font-medium text-foreground">sean</span>
                <span className="text-muted-foreground">approved</span>
              </div>
              <div className="mt-1 text-xs text-secondary-foreground ml-6">
                LGTM — clean implementation across all three tasks.
              </div>
            </div>

            <div className="rounded-xl border border-border bg-accent px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="size-4 rounded-full bg-primary/20 flex items-center justify-center text-[10px] text-primary">→</span>
                <span className="font-medium text-foreground">bob</span>
                <span className="text-muted-foreground">auto-review passed</span>
              </div>
              <div className="mt-1 text-xs text-secondary-foreground ml-6">
                Pre-landing review: no SQL safety issues, no trust boundary violations.
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button>Merge to main</Button>
            <Button variant="outline" size="sm">Squash and merge</Button>
          </div>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   5. FEATURE LIFECYCLE OVERVIEW
   ════════════════════════════════════════════════════════════════ */

export const FeatureLifecycleOverview: StoryObj = {
  name: "5. Feature Lifecycle",
  render: () => (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Feature Lifecycle</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How a feature moves from idea through to production in Bob.
        </p>
      </div>

      {/* Horizontal flow */}
      <div className="space-y-0">
        {[
          {
            phase: "1", label: "SHAPE", title: "Requirements",
            desc: "BRD defines what needs to be built. Requirements are categorized by layer (data, API, UI) and linked to the epic.",
            status: "complete",
            detail: "12 requirements defined",
          },
          {
            phase: "2", label: "PLAN", title: "Task Breakdown",
            desc: "Epic is broken into executable tasks. Each task owns a subset of requirements. Bob assigns agents to tasks based on dependencies.",
            status: "complete",
            detail: "5 tasks created",
          },
          {
            phase: "3", label: "EXECUTE", title: "Agent Dispatch",
            desc: "Bob agents work through tasks in dependency order. Each agent creates a branch, makes changes, runs tests, and creates a task-level PR.",
            status: "active",
            detail: "3/5 tasks done · 2 agents running",
          },
          {
            phase: "4", label: "VALIDATE", title: "Task PRs",
            desc: "Every task gets its own PR targeting the feature branch. CI runs on each — lint, typecheck, tests, build. Tasks can be reviewed independently.",
            status: "active",
            detail: "3 PRs merged · 2 pending",
          },
          {
            phase: "5", label: "COMBINE", title: "Feature PR",
            desc: "Once all tasks pass, task PRs are combined into a single feature PR targeting main. Requirements checklist is auto-verified against the BRD.",
            status: "pending",
            detail: "Waiting for remaining tasks",
          },
          {
            phase: "6", label: "REVIEW", title: "Final Review",
            desc: "Feature PR gets human review + Bob's pre-landing review (SQL safety, trust boundaries). CI runs the full suite against the combined changeset.",
            status: "pending",
            detail: "—",
          },
          {
            phase: "7", label: "SHIP", title: "Merge & Deploy",
            desc: "Feature PR merges to main. CI builds the image, gates pass, staging deploy happens automatically. Production requires explicit approval.",
            status: "pending",
            detail: "—",
          },
        ].map((step, i) => (
          <div key={step.phase} className="flex gap-4">
            {/* Phase indicator */}
            <div className="flex flex-col items-center w-10">
              <div className={cn(
                "size-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
                step.status === "complete" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : step.status === "active" ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-secondary text-muted-foreground border border-border",
              )}>
                {step.status === "complete" ? "✓" : step.phase}
              </div>
              {i < 6 && <div className="w-px flex-1 bg-border min-h-[16px]" />}
            </div>

            {/* Content */}
            <div className={cn(
              "flex-1 rounded-xl border px-5 py-4 mb-3",
              step.status === "active" ? "border-primary/30 bg-primary/5"
                : step.status === "complete" ? "border-border bg-card"
                : "border-border bg-secondary",
            )}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{step.label}</span>
                <span className="text-sm font-medium text-foreground">{step.title}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
              <div className="mt-2 text-xs font-mono text-muted-foreground">{step.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};
