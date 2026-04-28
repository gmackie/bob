import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { Separator } from "@bob/ui/separator";

const meta: Meta = {
  title: "Lifecycle/PR & Review",
};

export default meta;

/* ════════════════════════════════════════════════════════════════
   PR LIST
   ════════════════════════════════════════════════════════════════ */

export const PRList: StoryObj = {
  name: "PR List",
  render: () => (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-foreground">Pull Requests</h2>
        <div className="flex items-center gap-2">
          <Badge variant="emerald">3 open</Badge>
          <Badge variant="slate">12 merged</Badge>
        </div>
      </div>

      <div className="space-y-2">
        {[
          { number: "#14", title: "Add priority badge component", branch: "feature/wi-0043", status: "open", checks: "passing", reviewStatus: "approved", age: "2h ago", author: "bob" },
          { number: "#13", title: "Fix auth token refresh race condition", branch: "fix/wi-0019", status: "open", checks: "failing", reviewStatus: "changes_requested", age: "5h ago", author: "bob" },
          { number: "#12", title: "tRPC batch endpoint support", branch: "feature/wi-0015", status: "open", checks: "passing", reviewStatus: "pending", age: "1d ago", author: "bob" },
        ].map((pr) => (
          <div key={pr.number} className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 transition hover:border-muted-foreground/30 hover:shadow-sm cursor-pointer">
            <div className={cn(
              "size-2 rounded-full",
              pr.status === "open" ? "bg-emerald-400" : "bg-purple-400",
            )} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{pr.number}</span>
                <span className="text-sm font-medium text-foreground truncate">{pr.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{pr.branch}</span>
                <span>·</span>
                <span>{pr.author}</span>
                <span>·</span>
                <span>{pr.age}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pr.checks === "passing" ? (
                <span className="size-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400">✓</span>
              ) : (
                <span className="size-4 rounded-full bg-rose-500/20 flex items-center justify-center text-[10px] text-rose-400">✗</span>
              )}
              <Badge variant={
                pr.reviewStatus === "approved" ? "emerald"
                : pr.reviewStatus === "changes_requested" ? "rose"
                : "slate"
              } className="text-[10px]">
                {pr.reviewStatus === "changes_requested" ? "changes" : pr.reviewStatus}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   PR DETAIL
   ════════════════════════════════════════════════════════════════ */

export const PRDetail: StoryObj = {
  name: "PR Detail",
  render: () => (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">#14</span>
          <span>·</span>
          <Badge variant="emerald">Open</Badge>
          <span>·</span>
          <span className="font-mono">feature/wi-0043 → main</span>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
          Add priority badge component
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
          <span>bob opened 2h ago</span>
          <span>·</span>
          <span>3 files changed</span>
          <span>·</span>
          <span className="text-emerald-400">+56</span>
          <span className="text-rose-400">−0</span>
        </div>
      </div>

      {/* CI Status */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">CI / CD Pipeline</h3>
        <div className="space-y-2">
          {[
            { name: "Lint", status: "passed", duration: "12s" },
            { name: "Type Check", status: "passed", duration: "22s" },
            { name: "Unit Tests", status: "passed", duration: "47s" },
            { name: "Build", status: "passed", duration: "1m 8s" },
            { name: "Deploy Preview", status: "passed", duration: "34s" },
          ].map((check) => (
            <div key={check.name} className="flex items-center gap-3 text-sm">
              <span className="size-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400">✓</span>
              <span className="flex-1 text-foreground">{check.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{check.duration}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Diff */}
      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between bg-secondary px-4 py-2 border-b border-border">
          <span className="font-mono text-sm text-foreground">packages/ui/src/priority-badge.tsx</span>
          <Badge variant="emerald" className="text-[10px]">+47</Badge>
        </div>
        <div className="bg-card font-mono text-xs leading-6 p-4 overflow-x-auto">
          <div className="text-emerald-400">+ import type {"{"} VariantProps {"}"} from "class-variance-authority";</div>
          <div className="text-emerald-400">+ import {"{"} cva {"}"} from "class-variance-authority";</div>
          <div className="text-emerald-400">+</div>
          <div className="text-emerald-400">+ export const priorityVariants = cva(</div>
          <div className="text-emerald-400">+   "inline-flex items-center rounded-full px-2 py-0.5 text-xs",</div>
          <div className="text-emerald-400">+   {"{"}</div>
          <div className="text-emerald-400">+     variants: {"{"}</div>
          <div className="text-emerald-400">+       priority: {"{"}</div>
          <div className="text-emerald-400">+         urgent: "bg-rose-500/20 text-rose-300",</div>
          <div className="text-emerald-400">+         high: "bg-orange-500/20 text-orange-300",</div>
          <div className="text-emerald-400">+         medium: "bg-amber-500/20 text-amber-300",</div>
          <div className="text-emerald-400">+         low: "bg-blue-500/20 text-blue-300",</div>
          <div className="text-emerald-400">+         none: "bg-slate-500/20 text-slate-300",</div>
          <div className="text-emerald-400">+       {"}"},</div>
          <div className="text-emerald-400">+     {"}"},</div>
          <div className="text-emerald-400">+   {"}"}</div>
          <div className="text-emerald-400">+ );</div>
          <div className="text-muted-foreground mt-2">  ... +30 more lines</div>
        </div>
      </div>

      {/* Review section */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Review</h3>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="size-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400">✓</span>
            <span className="font-medium text-foreground">sean</span>
            <span className="text-muted-foreground">approved 30m ago</span>
          </div>
          <div className="mt-2 text-sm text-secondary-foreground ml-7">
            Clean implementation. Ship it.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button>Merge pull request</Button>
          <Button variant="outline" size="sm">Squash and merge</Button>
        </div>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   CHANGE SETS (JJ-style)
   ════════════════════════════════════════════════════════════════ */

export const ChangeSets: StoryObj = {
  name: "Change Sets",
  render: () => (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Change Sets</h2>
        <p className="mt-1 text-sm text-muted-foreground">Revision graph for the current workspace</p>
      </div>

      {/* Revision graph */}
      <div className="space-y-0">
        {[
          { id: "a3f2c891", desc: "Add priority badge component", branch: "feature/wi-0043", author: "bob", age: "2h", status: "current", parent: "e4a2f103" },
          { id: "e4a2f103", desc: "Update tRPC router for priority", branch: "feature/wi-0042", author: "bob", age: "5h", status: "immutable", parent: "7f2e0ba3" },
          { id: "7f2e0ba3", desc: "Add priority column migration", branch: "feature/wi-0041", author: "bob", age: "8h", status: "immutable", parent: "main@HEAD" },
          { id: "b1c4d9e8", desc: "fix: resolve build failures", branch: "main", author: "sean", age: "1d", status: "immutable", parent: null },
        ].map((rev, i) => (
          <div key={rev.id} className="flex gap-4">
            {/* Graph line */}
            <div className="flex flex-col items-center w-8">
              <div className={cn(
                "size-3 rounded-full border-2",
                rev.status === "current"
                  ? "border-primary bg-primary"
                  : "border-border bg-card",
              )} />
              {i < 3 && <div className="w-px flex-1 bg-border" />}
            </div>

            {/* Content */}
            <div className={cn(
              "flex-1 rounded-xl border px-4 py-3 mb-2 cursor-pointer transition",
              rev.status === "current"
                ? "border-primary/30 bg-primary/5"
                : "border-border bg-card hover:border-muted-foreground/30",
            )}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-primary font-medium">{rev.id}</span>
                {rev.status === "current" && <Badge variant="amber" className="text-[10px]">working copy</Badge>}
              </div>
              <div className="mt-1 text-sm text-foreground">{rev.desc}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{rev.branch}</span>
                <span>·</span>
                <span>{rev.author}</span>
                <span>·</span>
                <span>{rev.age}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button size="sm">New change set</Button>
        <Button variant="outline" size="sm">Squash</Button>
        <Button variant="outline" size="sm">Split</Button>
        <Button variant="outline" size="sm">Rebase</Button>
      </div>
    </div>
  ),
};

/* ════════════════════════════════════════════════════════════════
   ARTIFACT RELATIONSHIPS
   ════════════════════════════════════════════════════════════════ */

export const ArtifactRelationships: StoryObj = {
  name: "Artifact Relationships",
  render: () => (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-foreground">Task Artifacts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything produced during execution of WI-0043 — linked and traceable.
        </p>
      </div>

      {/* Flow diagram */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4">
        {[
          { label: "Task", detail: "WI-0043", color: "bg-amber-500/20 border-amber-500/30 text-amber-300" },
          { label: "Session", detail: "se-a3f2c8", color: "bg-blue-500/20 border-blue-500/30 text-blue-300" },
          { label: "Change Set", detail: "a3f2c891", color: "bg-purple-500/20 border-purple-500/30 text-purple-300" },
          { label: "PR", detail: "#14", color: "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" },
          { label: "Build", detail: "#847", color: "bg-blue-500/20 border-blue-500/30 text-blue-300" },
          { label: "Deploy", detail: "staging", color: "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" },
        ].map((node, i) => (
          <div key={node.label} className="flex items-center gap-2">
            {i > 0 && <div className="w-6 h-px bg-border" />}
            <div className={cn("rounded-lg border px-3 py-2 text-center min-w-[80px]", node.color)}>
              <div className="text-[10px] uppercase tracking-wide opacity-80">{node.label}</div>
              <div className="text-xs font-mono font-medium mt-0.5">{node.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <Separator />

      {/* Artifact detail list */}
      <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            role: "SESSION LOG", title: "Planning session se-a3f2c8",
            detail: "4m 12s · 23 messages · 3 tool calls",
            items: ["Analyzed existing badge patterns", "Created priority-badge.tsx", "Updated color mappings", "Ran typecheck (38/38 passed)"],
          },
          {
            role: "CHANGE SET", title: "a3f2c891 — feature/wi-0043",
            detail: "3 files · +56 −0",
            items: ["packages/ui/src/priority-badge.tsx (+47)", "apps/web/src/lib/design/colors.ts (+8)", "packages/ui/src/index.ts (+1)"],
          },
          {
            role: "TEST RESULTS", title: "Build #847 test suite",
            detail: "38/38 passed · 0 failed · 22.6s",
            items: ["typecheck: 38 tasks (19.1s)", "lint: clean (3.5s)"],
          },
          {
            role: "BUILD OUTPUT", title: "Build #847",
            detail: "sha256:a3f2c8 · 47.2s · 12.4MB",
            items: ["Image: harbor.internal/bob/web:a3f2c891", "Base: node:22-alpine", "Layers: 14 (7 cached)"],
          },
        ].map((artifact) => (
          <div key={artifact.role} className="rounded-2xl border border-border bg-card p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{artifact.role}</div>
            <div className="mt-2 text-sm font-medium text-foreground">{artifact.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{artifact.detail}</div>
            <div className="mt-3 space-y-1">
              {artifact.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-secondary-foreground">
                  <span className="size-1 rounded-full bg-muted-foreground/40" />
                  <span className="font-mono">{item}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};
