import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";
import { Card, CardContent, CardHeader, CardFooter } from "@gmacko/core/ui/card";
import { Separator } from "@gmacko/core/ui/separator";

const meta: Meta = {
  title: "Lifecycle/Work Items",
};

export default meta;

/* ════════════════════════════════════════════════════════════════
   1. IDEA → ISSUE
   ════════════════════════════════════════════════════════════════ */

export const IdeaCapture: StoryObj = {
  name: "1. Idea → Issue",
  render: () => (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Capture an idea</h2>
        <p className="mt-1 text-sm text-muted-foreground">Issues capture work to be shaped before execution.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
            WI-0045
            <Badge variant="blue">Issue</Badge>
            <Badge variant="slate">Backlog</Badge>
          </div>
          <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">
            Add priority sorting to the work item board
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-secondary-foreground">
            Users should be able to sort kanban columns by priority so urgent items surface to the top.
            This needs a priority column on work_items, a tRPC endpoint update, and board UI changes.
          </p>
          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <span>0 child items</span>
            <span>0 comments</span>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm">
            Promote to Task →
          </Button>
          <span className="ml-3 text-xs text-muted-foreground">
            Promote when ready for Bob to execute
          </span>
        </CardFooter>
      </Card>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   2. EPIC BREAKDOWN
   ════════════════════════════════════════════════════════════════ */

export const EpicBreakdown: StoryObj = {
  name: "2. Epic → Tasks",
  render: () => (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Break down an epic</h2>
        <p className="mt-1 text-sm text-muted-foreground">Epics organize work before execution. Break them into executable tasks.</p>
      </div>

      {/* Epic header */}
      <div className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
          WI-0040 <Badge variant="purple">Epic</Badge> <Badge variant="amber">In Progress</Badge>
        </div>
        <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">
          Priority system for work items
        </h3>
        <p className="mt-3 text-sm text-secondary-foreground">
          Full priority support: database column, API updates, board UI, filtering, and sorting.
        </p>
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          <span>5 child items</span>
          <span>2 comments</span>
        </div>
      </div>

      {/* Child tasks */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Child Tasks</h3>
        {[
          { id: "WI-0041", title: "Add priority column migration", status: "done", kind: "task", priority: "urgent" },
          { id: "WI-0042", title: "Update tRPC router for priority", status: "done", kind: "task", priority: "high" },
          { id: "WI-0043", title: "Priority badge component", status: "in_progress", kind: "task", priority: "high" },
          { id: "WI-0044", title: "Board priority indicators", status: "todo", kind: "task", priority: "medium" },
          { id: "WI-0045", title: "Priority filter bar", status: "backlog", kind: "task", priority: "low" },
        ].map((item) => {
          const STATUS_COLOR: Record<string, "emerald" | "amber" | "blue" | "slate"> = {
            done: "emerald", in_progress: "amber", todo: "blue", backlog: "slate",
          };
          const PRIORITY_BORDER: Record<string, string> = {
            urgent: "border-l-rose-500", high: "border-l-orange-500", medium: "border-l-amber-500", low: "border-l-blue-500",
          };
          return (
            <div key={item.id} className={cn(
              "flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 cursor-pointer transition hover:border-muted-foreground/30",
              PRIORITY_BORDER[item.priority] && `border-l-2 ${PRIORITY_BORDER[item.priority]}`,
            )}>
              <span className="font-mono text-xs text-muted-foreground w-16">{item.id}</span>
              <span className="flex-1 text-sm text-foreground">{item.title}</span>
              <Badge variant={STATUS_COLOR[item.status] ?? "default"} className="text-[10px]">
                {item.status.replace(/_/g, " ")}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   3. TASK DETAIL — Ready for execution
   ════════════════════════════════════════════════════════════════ */

export const TaskReadyForExecution: StoryObj = {
  name: "3. Task — Ready",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              WI-0043 <Badge variant="amber">Task</Badge>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">
              Priority badge component
            </h1>
          </div>
          <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            PRIO · Priority system
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Badge variant="blue">Todo</Badge>
          <Badge variant="orange">High</Badge>
          <span className="text-sm text-muted-foreground">0 child items</span>
          <span className="text-sm text-muted-foreground">1 comment</span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button className="rounded-full">Open execution workspace</Button>
          <Button variant="outline" size="sm">Chat with Bob</Button>
        </div>

        <p className="mt-6 max-w-3xl text-sm leading-7 text-muted-foreground">
          Create a PriorityBadge component that renders a colored badge based on the work item priority level.
          Should support urgent (rose), high (orange), medium (amber), low (blue), and none (slate).
          Include a dropdown variant for inline editing on the detail view.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Discussion</h2>
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-border bg-accent px-4 py-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">sean</span>
                <span>2h ago</span>
              </div>
              <div className="mt-2 text-sm text-secondary-foreground">
                Use the existing badge variants from @bob/ui — just wire up the color mapping.
                Check how StatusSelect does it for reference.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Current Artifacts</h2>
          <div className="mt-4 rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground text-center">
            No artifacts attached.
          </div>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   4. TASK — Agent executing (session active)
   ════════════════════════════════════════════════════════════════ */

export const TaskAgentExecuting: StoryObj = {
  name: "4. Task — Agent Running",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              WI-0043 <Badge variant="amber">Task</Badge>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">
              Priority badge component
            </h1>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Badge variant="amber">In Progress</Badge>
          <Badge variant="orange">High</Badge>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-sm text-muted-foreground">Agent running</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button className="rounded-full">Resume live workspace</Button>
          <Button variant="outline" size="sm">Chat with Bob</Button>
          <Button variant="outline" size="sm">Stop</Button>
        </div>
      </div>

      {/* Agent workspace preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* File changes */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground mb-3">Changed Files</h3>
          <div className="space-y-1">
            {[
              { file: "packages/ui/src/priority-badge.tsx", status: "added", lines: "+47" },
              { file: "apps/web/src/lib/design/colors.ts", status: "modified", lines: "+8 -0" },
              { file: "packages/ui/src/index.ts", status: "modified", lines: "+1" },
            ].map((f) => (
              <div key={f.file} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent cursor-pointer">
                <span className={cn(
                  "size-1.5 rounded-full",
                  f.status === "added" ? "bg-emerald-400" : "bg-amber-400"
                )} />
                <span className="flex-1 font-mono text-xs text-foreground truncate">{f.file}</span>
                <span className="font-mono text-[10px] text-emerald-400">{f.lines}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Terminal output */}
        <div className="rounded-2xl border border-[#2E2D2A] bg-[#0E0D0B] p-4 font-mono text-xs leading-6 text-[#EEEDEA]">
          <div className="text-[10px] text-[#6E6B64] mb-2">TERMINAL — bob agent</div>
          <div><span className="text-[#E8A33C]">$</span> creating priority-badge.tsx...</div>
          <div><span className="text-[#4CAF50]">✓</span> component created with 5 variants</div>
          <div><span className="text-[#E8A33C]">$</span> updating color mappings...</div>
          <div><span className="text-[#4CAF50]">✓</span> PRIORITY_COLOR added to colors.ts</div>
          <div><span className="text-[#E8A33C]">$</span> running typecheck...</div>
          <div><span className="text-[#4CAF50]">✓</span> 38 tasks passed</div>
          <div><span className="text-[#E8A33C]">$</span> <span className="opacity-40">_</span></div>
        </div>
      </div>

      {/* Latest run status */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Latest run:</span>
        <Badge variant="blue">Running</Badge>
        <span className="font-mono text-xs text-muted-foreground">feature/wi-0043-priority-badge</span>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   5. TASK — Completed with artifacts
   ════════════════════════════════════════════════════════════════ */

export const TaskCompletedWithArtifacts: StoryObj = {
  name: "5. Task — Completed + Artifacts",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              WI-0043 <Badge variant="amber">Task</Badge>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">
              Priority badge component
            </h1>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Badge variant="emerald">Done</Badge>
          <Badge variant="orange">High</Badge>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-muted-foreground">Completed in 4m 12s</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        {/* Discussion */}
        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Discussion</h2>
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-border bg-accent px-4 py-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">sean</span>
                <span>3h ago</span>
              </div>
              <div className="mt-2 text-sm text-secondary-foreground">
                Use the existing badge variants from @bob/ui.
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-accent px-4 py-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-primary">bob</span>
                <span>42m ago</span>
              </div>
              <div className="mt-2 text-sm text-secondary-foreground">
                Done. Created PriorityBadge with 5 variants (urgent/high/medium/low/none),
                added PRIORITY_COLOR mapping, and exported from @bob/ui. Typecheck passes.
              </div>
            </div>
          </div>
        </div>

        {/* Artifacts */}
        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Artifacts</h2>
          <div className="mt-4 space-y-3">
            {[
              { role: "CHANGE SET", title: "feature/wi-0043-priority-badge", icon: "🔀", detail: "3 files changed, +56 −0" },
              { role: "PR", title: "PR #14: Add priority badge component", icon: "📋", detail: "Ready for review" },
              { role: "BUILD", title: "Build #847 — passed", icon: "🏗️", detail: "47.2s · sha256:a3f2c8" },
              { role: "TEST RESULTS", title: "38/38 tasks passed", icon: "✅", detail: "0 failures · 22.6s" },
              { role: "DEPLOYMENT", title: "Staging — healthy", icon: "🚀", detail: "Deployed 4m ago" },
            ].map((artifact) => (
              <div key={artifact.role} className="rounded-2xl border border-border bg-accent px-4 py-4 cursor-pointer transition hover:border-muted-foreground/30">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{artifact.icon}</span>
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{artifact.role}</span>
                </div>
                <div className="mt-2 text-sm text-foreground">{artifact.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{artifact.detail}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Build & Deploy */}
        <div className="rounded-3xl border border-border bg-secondary p-6 xl:col-span-2">
          <h2 className="font-display text-lg font-semibold text-foreground">Build & Deploy</h2>
          <div className="mt-4 space-y-5">
            {/* Revision bar */}
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">feature/wi-0043-priority-badge</span>
                <span className="font-mono">a3f2c891</span>
              </div>
              <div className="flex items-center gap-1">
                {["Lint", "Test", "Build", "Deploy"].map((gate, i) => (
                  <div key={gate} className="flex items-center">
                    {i > 0 && <div className="mx-1 h-0.5 w-4 bg-emerald-500/40" />}
                    <Badge variant="emerald" className="text-[10px]">{gate}</Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Deployment cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">STAGING</span>
                  <Badge variant="emerald">healthy</Badge>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Deployed 4m ago</div>
              </div>
              <div className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">PRODUCTION</span>
                  <Badge variant="amber">pending</Badge>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">Awaiting approval</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};
