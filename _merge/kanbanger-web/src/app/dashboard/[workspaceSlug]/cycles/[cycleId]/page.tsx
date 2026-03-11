"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Progress } from "@linear-clone/ui/components/progress";
import { Tabs, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { useIssueBobContext } from "@/components/tasks/use-issue-bob-context";
import type { TaskStatus } from "@/components/tasks/status-badge";
import type { TaskPriority } from "@/components/tasks/priority-badge";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  ArrowLeft,
  Calendar,
  RefreshCw,
  Settings,
  PlayCircle,
  CheckCircle2,
  Clock,
  LayoutList,
  BarChart3,
} from "lucide-react";

type ViewTab = "tasks" | "burndown";
type CycleStatus = "upcoming" | "active" | "completed";

function getStatusIcon(status: CycleStatus) {
  switch (status) {
    case "active":
      return <PlayCircle className="h-4 w-4 text-green-500" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
    case "upcoming":
      return <Clock className="h-4 w-4 text-yellow-500" />;
    default:
      return null;
  }
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDaysRemaining(endDate: Date) {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function BurndownChart({
  startDate,
  endDate,
  totalIssues,
  completedIssues,
}: {
  startDate: Date;
  endDate: Date;
  totalIssues: number;
  completedIssues: number;
}) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();

  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  const idealBurnRate = totalIssues / totalDays;
  const actualRemaining = totalIssues - completedIssues;
  const _idealRemaining = Math.max(0, totalIssues - idealBurnRate * daysElapsed);

  const chartHeight = 200;
  const chartWidth = 400;
  const padding = 40;

  const xScale = (day: number) =>
    padding + (day / totalDays) * (chartWidth - padding * 2);
  const yScale = (issues: number) =>
    padding + ((totalIssues - issues) / totalIssues) * (chartHeight - padding * 2);

  const idealLinePoints = Array.from({ length: totalDays + 1 }, (_, i) => {
    const x = xScale(i);
    const y = yScale(totalIssues - i * idealBurnRate);
    return `${x},${y}`;
  }).join(" ");

  const currentDay = Math.min(daysElapsed, totalDays);
  const actualPoint = { x: xScale(currentDay), y: yScale(actualRemaining) };

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-4 font-medium">Burndown Chart</h3>

      <div className="relative">
        <svg
          width={chartWidth}
          height={chartHeight}
          className="text-muted-foreground"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        >
          <line
            x1={padding}
            y1={chartHeight - padding}
            x2={chartWidth - padding}
            y2={chartHeight - padding}
            stroke="currentColor"
            strokeWidth={1}
          />
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={chartHeight - padding}
            stroke="currentColor"
            strokeWidth={1}
          />

          <polyline
            points={idealLinePoints}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={0.5}
          />

          <line
            x1={padding}
            y1={yScale(totalIssues)}
            x2={actualPoint.x}
            y2={actualPoint.y}
            stroke="#3b82f6"
            strokeWidth={2}
          />

          <circle cx={actualPoint.x} cy={actualPoint.y} r={5} fill="#3b82f6" />

          <text x={padding} y={chartHeight - 10} className="text-xs fill-current">
            Start
          </text>
          <text
            x={chartWidth - padding}
            y={chartHeight - 10}
            textAnchor="end"
            className="text-xs fill-current"
          >
            End
          </text>
          <text x={10} y={padding + 4} className="text-xs fill-current">
            {totalIssues}
          </text>
          <text x={10} y={chartHeight - padding} className="text-xs fill-current">
            0
          </text>
        </svg>

        <div className="mt-4 flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4 bg-muted-foreground opacity-50" style={{ borderStyle: "dashed" }} />
            <span className="text-muted-foreground">Ideal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4 bg-blue-500" />
            <span className="text-muted-foreground">Actual</span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-semibold">{actualRemaining}</p>
          <p className="text-xs text-muted-foreground">Remaining</p>
        </div>
        <div>
          <p className="text-2xl font-semibold">{completedIssues}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div>
          <p className="text-2xl font-semibold">{daysRemaining}</p>
          <p className="text-xs text-muted-foreground">Days Left</p>
        </div>
      </div>
    </div>
  );
}

function StatusBreakdown({
  stats,
}: {
  stats: {
    total: number;
    completed: number;
    inProgress: number;
    todo: number;
    backlog: number;
  };
}) {
  const items = [
    { label: "Done", count: stats.completed, color: "bg-green-500" },
    { label: "In Progress", count: stats.inProgress, color: "bg-blue-500" },
    { label: "Todo", count: stats.todo, color: "bg-yellow-500" },
    { label: "Backlog", count: stats.backlog, color: "bg-gray-400" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-4 font-medium">Status Breakdown</h3>
      <div className="space-y-3">
        {items.map((item) => {
          const percentage = stats.total > 0 ? (item.count / stats.total) * 100 : 0;
          return (
            <div key={item.label}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span>{item.label}</span>
                <span className="text-muted-foreground">
                  {item.count} ({Math.round(percentage)}%)
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", item.color)}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CycleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;
  const cycleId = params.cycleId as string;

  const [activeTab, setActiveTab] = useState<ViewTab>("tasks");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: cycle, isLoading: cycleLoading } = api.cycle.get.useQuery(
    { id: cycleId },
    { enabled: !!cycleId }
  );

  const { data: cycleIssues, isLoading: issuesLoading } = api.cycle.issues.useQuery(
    { cycleId },
    { enabled: !!cycleId }
  );

  const { data: selectedTask } = api.issue.get.useQuery(
    { id: selectedTaskId ?? "" },
    { enabled: !!selectedTaskId }
  );
  const { bobRunHistory, childArtifactGroups } = useIssueBobContext(
    selectedTaskId,
    selectedTask?.subIssuesCount ?? 0
  );

  const utils = api.useUtils();

  const updateTaskMutation = api.issue.update.useMutation({
    onSuccess: () => {
      utils.issue.get.invalidate();
      utils.cycle.issues.invalidate();
      utils.cycle.get.invalidate();
    },
  });

  const handleStatusChange = async (status: TaskStatus) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, status });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!selectedTaskId) return;
    await updateTaskMutation.mutateAsync({ id: selectedTaskId, priority });
  };

  if (cycleLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <h1 className="text-xl font-semibold">Cycle not found</h1>
        <p className="mt-2 text-muted-foreground">
          The cycle you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button
          variant="link"
          onClick={() => router.push(`/dashboard/${workspaceSlug}/cycles`)}
        >
          Go back to cycles
        </Button>
      </div>
    );
  }

  const progress =
    cycle.stats.total > 0
      ? Math.round((cycle.stats.completed / cycle.stats.total) * 100)
      : 0;

  const daysRemaining = getDaysRemaining(cycle.endDate);

  const mappedTasks =
    cycleIssues?.map((task) => ({
      id: task.id,
      identifier: task.identifier,
      title: task.title,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      assignee: task.assignee,
      labels: task.labels,
      project: task.project,
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      bobView: (
        task as { bobView?: import("@/components/tasks/bob-task-indicators").BobTaskProjection | null }
      ).bobView,
    })) ?? [];

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => router.push(`/dashboard/${workspaceSlug}/cycles`)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <RefreshCw className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">
                    {cycle.name ?? `Cycle ${cycle.number}`}
                  </h1>
                  {getStatusIcon(cycle.status as CycleStatus)}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
                    style={{
                      backgroundColor: `${cycle.team.color ?? "#6366f1"}15`,
                      color: cycle.team.color ?? "#6366f1",
                    }}
                  >
                    {cycle.team.key ?? cycle.team.name}
                  </span>
                  <span>•</span>
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
                  </span>
                  {cycle.status === "active" && daysRemaining > 0 && (
                    <>
                      <span>•</span>
                      <span>
                        {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {cycle.stats.completed} of {cycle.stats.total} tasks completed
              </span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ViewTab)}
            className="mt-4"
          >
            <TabsList>
              <TabsTrigger value="tasks" className="gap-1.5">
                <LayoutList className="h-3.5 w-3.5" />
                Tasks
              </TabsTrigger>
              <TabsTrigger value="burndown" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Progress
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "tasks" && (
          <div className="flex-1 overflow-auto">
            <TaskList
              tasks={mappedTasks}
              loading={issuesLoading}
              selectedTaskId={selectedTaskId}
              onTaskClick={(task) => setSelectedTaskId(task.id)}
              emptyMessage="No tasks in this cycle"
            />
          </div>
        )}

        {activeTab === "burndown" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <BurndownChart
                startDate={cycle.startDate}
                endDate={cycle.endDate}
                totalIssues={cycle.stats.total}
                completedIssues={cycle.stats.completed}
              />
              <StatusBreakdown stats={cycle.stats} />
            </div>

            {cycle.description && (
              <div className="mt-6 rounded-lg border border-border bg-card p-6">
                <h3 className="mb-2 font-medium">Description</h3>
                <p className="text-sm text-muted-foreground">{cycle.description}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedTask && (
        <div className="min-w-[24rem] w-[44rem] max-w-[70vw] border-l border-border">
          <TaskDetail
            task={{
              id: selectedTask.id,
              identifier: selectedTask.identifier,
              title: selectedTask.title,
              description: selectedTask.description,
              status: selectedTask.status as TaskStatus,
              priority: selectedTask.priority as TaskPriority,
              creator: selectedTask.creator,
              assignee: selectedTask.assignee,
              project: selectedTask.project,
              labels: selectedTask.labels,
              dueDate: selectedTask.dueDate,
              estimate: selectedTask.estimate,
              createdAt: selectedTask.createdAt,
              updatedAt: selectedTask.updatedAt,
              bobRun: selectedTask.bobRun,
              bobRunHistory,
              currentArtifacts: selectedTask.currentArtifacts,
              childArtifactGroups,
            }}
            onClose={() => setSelectedTaskId(null)}
            onStatusChange={handleStatusChange}
            onPriorityChange={handlePriorityChange}
          />
        </div>
      )}
    </div>
  );
}
