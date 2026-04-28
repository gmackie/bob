import type { Meta, StoryObj } from "@storybook/react";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

const meta: Meta = {
  title: "App/ForgeGraph",
};

export default meta;

/* ─── Gate Decision Card ─── */

interface Gate { name: string; status: "pending" | "passed" | "failed" | "running"; }

function GateCardDemo({ gates, footer }: { gates: Gate[]; footer: string }) {
  const BUILD_COLOR: Record<string, "slate" | "blue" | "emerald" | "rose"> = {
    pending: "slate", running: "blue", passed: "emerald", failed: "rose",
  };
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 w-80">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Gate progression</div>
      <div className="mt-3 space-y-2">
        {gates.map((g) => (
          <div key={g.name} className="flex items-center justify-between text-sm">
            <span className="text-secondary-foreground">{g.name}</span>
            <Badge variant={BUILD_COLOR[g.status]}>{g.status}</Badge>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">{footer}</div>
    </div>
  );
}

export const GateDecisionInProgress: StoryObj = {
  name: "Gate Card — In Progress",
  render: () => (
    <GateCardDemo
      gates={[
        { name: "Lint", status: "passed" },
        { name: "Test", status: "passed" },
        { name: "Build", status: "running" },
        { name: "Deploy", status: "pending" },
      ]}
      footer="Gates in progress..."
    />
  ),
};

export const GateDecisionAllPassed: StoryObj = {
  name: "Gate Card — All Passed",
  render: () => (
    <GateCardDemo
      gates={[
        { name: "Lint", status: "passed" },
        { name: "Test", status: "passed" },
        { name: "Build", status: "passed" },
      ]}
      footer="All gates passed — ready for production."
    />
  ),
};

export const GateDecisionFailed: StoryObj = {
  name: "Gate Card — Failed",
  render: () => (
    <GateCardDemo
      gates={[
        { name: "Lint", status: "passed" },
        { name: "Test", status: "failed" },
        { name: "Build", status: "pending" },
      ]}
      footer="A gate has failed — check build logs."
    />
  ),
};

export const GateCardUnavailable: StoryObj = {
  name: "Gate Card — Unavailable",
  render: () => (
    <div className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground w-80">
      Gate status unavailable
    </div>
  ),
};

/* ─── Revision Status Bar ─── */

function RevisionBarDemo({ branch, sha, gates }: {
  branch: string; sha: string;
  gates: { name: string; status: string }[];
}) {
  const BUILD_COLOR: Record<string, "slate" | "blue" | "emerald" | "rose"> = {
    pending: "slate", running: "blue", passed: "emerald", failed: "rose",
  };
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{branch}</span>
        <span className="font-mono">{sha}</span>
      </div>
      <div className="flex items-center gap-1">
        {gates.map((g, i) => (
          <div key={g.name} className="flex items-center">
            {i > 0 && (
              <div className={cn(
                "mx-1 h-0.5 w-4",
                g.status === "passed" ? "bg-emerald-500/40"
                  : g.status === "failed" ? "bg-rose-500/40" : "bg-accent",
              )} />
            )}
            <Badge variant={BUILD_COLOR[g.status] ?? "default"} className="text-[10px]">{g.name}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

export const RevisionBarPassing: StoryObj = {
  name: "Revision Bar — Passing",
  render: () => (
    <RevisionBarDemo branch="main" sha="a3f2c891" gates={[
      { name: "Lint", status: "passed" },
      { name: "Test", status: "passed" },
      { name: "Build", status: "running" },
      { name: "Deploy", status: "pending" },
    ]} />
  ),
};

export const RevisionBarFailed: StoryObj = {
  name: "Revision Bar — Failed",
  render: () => (
    <RevisionBarDemo branch="main" sha="7f2e0ba3" gates={[
      { name: "Lint", status: "passed" },
      { name: "Test", status: "failed" },
      { name: "Build", status: "pending" },
      { name: "Deploy", status: "pending" },
    ]} />
  ),
};

/* ─── Build History ─── */

export const BuildHistory: StoryObj = {
  render: () => (
    <div className="space-y-2 w-[500px]">
      {[
        { status: "passed", duration: "47.2s", artifact: "sha256:a3f2c8", time: "2m ago" },
        { status: "passed", duration: "51.8s", artifact: "sha256:7f2e0b", time: "1h ago" },
        { status: "failed", duration: "12.3s", artifact: null, time: "2h ago" },
        { status: "passed", duration: "49.1s", artifact: "sha256:e4a2f1", time: "5h ago" },
      ].map((b, i) => (
        <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <Badge variant={b.status === "passed" ? "emerald" : "rose"}>{b.status}</Badge>
            <span className="text-xs text-muted-foreground">{b.duration}</span>
          </div>
          <div className="flex items-center gap-3">
            {b.artifact && <span className="font-mono text-xs text-blue-400">{b.artifact}</span>}
            <span className="text-xs text-muted-foreground">{b.time}</span>
          </div>
        </div>
      ))}
    </div>
  ),
};

/* ─── Deployment Status ─── */

export const DeploymentStatusCards: StoryObj = {
  name: "Deployment Status",
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2 w-[420px]">
      {[
        { env: "STAGING", status: "healthy", time: "Deployed 4m ago" },
        { env: "PRODUCTION", status: "pending", time: "Awaiting approval" },
      ].map((d) => {
        const DEPLOY_COLOR: Record<string, "amber" | "blue" | "emerald" | "rose" | "slate"> = {
          pending: "amber", deploying: "blue", healthy: "emerald", unhealthy: "rose", rolled_back: "slate",
        };
        return (
          <div key={d.env} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{d.env}</span>
              <Badge variant={DEPLOY_COLOR[d.status] ?? "default"}>{d.status}</Badge>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{d.time}</div>
          </div>
        );
      })}
    </div>
  ),
};
