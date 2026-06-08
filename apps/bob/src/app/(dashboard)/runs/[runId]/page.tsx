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

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";
import { Card } from "@gmacko/core/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import {
  collapseSessionEventsToMessages,
  formatSessionLogArtifactText,
  formatSessionEventText,
  normalizeSessionEventRecords,
} from "~/components/runs/session-event-format";
import {
  getRunDetailBackHref,
  getRunDetailWorkItemHref,
} from "~/components/dashboard/provider-runs-model";
import { useTRPC } from "~/trpc/react";

// ── Constants ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  interrupted: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
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
  const runTitle = (run as any).session?.title ?? run.workItemId ?? "Untitled";
  const backHref = getRunDetailBackHref(run.workspaceId);
  const workItemHref = run.workItemId
    ? getRunDetailWorkItemHref(run.workItemId, run.workspaceId)
    : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        items={[
          { label: "Runs", href: backHref },
          { label: runTitle },
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
              {workItemHref ? (
                <Link href={workItemHref} className="hover:text-primary">
                  {runTitle}
                </Link>
              ) : (
                runTitle
              )}
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
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-3.5" /> All runs
        </Link>
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
      {activeTab === "summary" && (
        <SummaryTab
          run={run}
          duration={duration}
          filesChanged={filesChanged}
          exitCode={exitCode}
          workItemHref={workItemHref}
        />
      )}
      {activeTab === "chat" && <ChatTab run={run} />}
      {activeTab === "files" && <FilesTab run={run} />}
      {activeTab === "diff" && <DiffTab run={run} />}
      {activeTab === "artifacts" && <ArtifactsTab run={run} />}
    </div>
  );
}

// ── Summary Tab ───────────────────────────────────────────────────────

function SummaryTab({ run, duration, filesChanged, exitCode, workItemHref }: {
  run: any;
  duration: number | null;
  filesChanged: number;
  exitCode: number | null;
  workItemHref: string | null;
}) {
  const computedDuration = duration ?? (
    run.startedAt && run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : null
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Status</p>
          <p className="mt-1 text-lg font-semibold capitalize">{run.status}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Duration</p>
          <p className="mt-1 text-lg font-semibold">{computedDuration ? formatDuration(computedDuration) : "—"}</p>
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

      {run.summary?.reason && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Failure Reason
          </p>
          <p className="mt-1 text-sm text-foreground">{run.summary.reason}</p>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">Run Details</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <div><span className="text-muted-foreground">Run ID:</span> <span className="font-mono text-xs">{run.id}</span></div>
          <div><span className="text-muted-foreground">Agent:</span> {run.agentType}</div>
          <div><span className="text-muted-foreground">Started:</span> {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</div>
          <div><span className="text-muted-foreground">Completed:</span> {run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</div>
          <div>
            <span className="text-muted-foreground">Work Item:</span>{" "}
            {workItemHref ? (
              <Link href={workItemHref} className="text-primary hover:underline">{run.workItemId}</Link>
            ) : "—"}
          </div>
          {run.sessionId && (
            <div>
              <span className="text-muted-foreground">Session:</span>{" "}
              <span className="font-mono text-xs">{run.sessionId.slice(0, 8)}</span>
            </div>
          )}
          <div><span className="text-muted-foreground">Workspace:</span> <span className="font-mono text-xs">{run.workspaceId}</span></div>
        </div>
      </Card>
    </div>
  );
}

// ── Chat Tab ──────────────────────────────────────────────────────────

function ChatTab({ run }: { run: any }) {
  const trpc = useTRPC();

  const { data: events } = useQuery({
    ...trpc.session.getEvents.queryOptions(
      { sessionId: run.sessionId, limit: 200 },
    ),
    enabled: !!run.sessionId,
  });

  const logArtifact = run.artifacts?.find((a: any) => a.type === "log");
  const eventList = normalizeSessionEventRecords(events);
  const messages = collapseSessionEventsToMessages(eventList);

  if (!run.sessionId && !logArtifact) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No agent output captured for this run.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Session Output</h3>
          <div className="max-h-[600px] overflow-y-auto space-y-2">
            {messages.map((message) => (
              <div key={`${message.seq}-${message.role}`} className="rounded bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {message.role === "user" ? "You" : "Agent"}
                </div>
                {message.toolCalls?.length ? (
                  <div className="font-mono text-xs">
                    Tool: {message.toolCalls.map((tool) => tool.name).join(", ")}
                  </div>
                ) : (
                  <div>
                    {message.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {messages.length === 0 && run.sessionId && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Session Events</h3>
          {eventList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded for this session.</p>
          ) : (
            <div className="max-h-[600px] overflow-y-auto space-y-1">
              {eventList.map((evt) => {
                const text = formatSessionEventText(evt.eventType, evt.payload).slice(0, 120);

                return (
                  <div key={evt.id ?? `${evt.seq}-${evt.eventType}`} className="flex items-center gap-3 py-1.5 text-xs">
                    <span className="text-muted-foreground shrink-0 font-mono w-16">
                      #{evt.seq}
                    </span>
                    <Badge variant="slate" className="text-[9px] shrink-0">
                      {evt.eventType}
                    </Badge>
                    <span className="text-muted-foreground truncate">
                      {text || "No display output"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {logArtifact && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Log Artifact</h3>
          <pre className="overflow-x-auto rounded bg-muted p-4 font-mono text-xs leading-relaxed max-h-[600px] overflow-y-auto">
            {formatSessionLogArtifactText({
              content: logArtifact.metadata?.content,
              lines: logArtifact.metadata?.lines,
            })}
          </pre>
        </Card>
      )}
    </div>
  );
}

// ── Files Tab ─────────────────────────────────────────────────────────

function FilesTab({ run }: { run: any }) {
  const diffArtifact = run.artifacts?.find((a: any) => a.type === "diff");

  if (!diffArtifact?.metadata?.files) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No file change data for this run.
        </p>
      </Card>
    );
  }

  const fileList = diffArtifact.metadata.files as Array<{ path: string; status: string; additions: number; deletions: number }>;
  return <FileList files={fileList} />;
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

function DiffTab({ run }: { run: any }) {
  const diffArtifact = run.artifacts?.find((a: any) => a.type === "diff");

  if (!diffArtifact) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">
          No diff data for this run.
        </p>
      </Card>
    );
  }

  const rawDiff = diffArtifact?.metadata?.patch || `${diffArtifact?.metadata?.files_changed ?? 0} files changed, ${diffArtifact?.metadata?.insertions ?? 0} insertions(+), ${diffArtifact?.metadata?.deletions ?? 0} deletions(-)`;

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
