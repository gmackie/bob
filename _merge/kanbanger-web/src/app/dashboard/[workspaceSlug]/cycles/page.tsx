"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Progress } from "@linear-clone/ui/components/progress";
import { Tabs, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { cn } from "@linear-clone/ui/lib/utils";
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  PlayCircle,
  Circle,
} from "lucide-react";

type CycleStatus = "upcoming" | "active" | "completed";
type StatusFilter = CycleStatus | "all";

interface Cycle {
  id: string;
  teamId: string;
  name: string | null;
  description: string | null;
  number: number;
  status: CycleStatus;
  startDate: Date;
  endDate: Date;
  progress: number;
  team: {
    id: string;
    name: string;
    key: string | null;
    color: string | null;
  };
  issueCount: number;
  completedCount: number;
}

function getStatusIcon(status: CycleStatus) {
  switch (status) {
    case "active":
      return <PlayCircle className="h-4 w-4 text-green-500" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
    case "upcoming":
      return <Clock className="h-4 w-4 text-yellow-500" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

function getStatusLabel(status: CycleStatus) {
  switch (status) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "upcoming":
      return "Upcoming";
    default:
      return status;
  }
}

function formatDateRange(start: Date, end: Date) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (startDate.getFullYear() !== endDate.getFullYear()) {
    return `${startDate.toLocaleDateString("en-US", { ...options, year: "numeric" })} - ${endDate.toLocaleDateString("en-US", { ...options, year: "numeric" })}`;
  }

  return `${startDate.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`;
}

function getDaysRemaining(endDate: Date) {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function CycleCard({
  cycle,
  onClick,
}: {
  cycle: Cycle;
  onClick: () => void;
}) {
  const progress =
    cycle.issueCount > 0
      ? Math.round((cycle.completedCount / cycle.issueCount) * 100)
      : 0;
  const daysRemaining = getDaysRemaining(cycle.endDate);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {getStatusIcon(cycle.status)}
          <div>
            <h3 className="font-medium">
              {cycle.name ?? `Cycle ${cycle.number}`}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${cycle.team.color ?? "#6366f1"}15`,
                  color: cycle.team.color ?? "#6366f1",
                }}
              >
                {cycle.team.key ?? cycle.team.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateRange(cycle.startDate, cycle.endDate)}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              cycle.status === "active" && "bg-green-500/10 text-green-600",
              cycle.status === "completed" && "bg-blue-500/10 text-blue-600",
              cycle.status === "upcoming" && "bg-yellow-500/10 text-yellow-600"
            )}
          >
            {getStatusLabel(cycle.status)}
          </span>
          {cycle.status === "active" && daysRemaining > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} left
            </p>
          )}
        </div>
      </div>

      {cycle.description && (
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {cycle.description}
        </p>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {cycle.completedCount} of {cycle.issueCount} tasks
          </span>
          <span className="font-medium">{progress}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>
    </button>
  );
}

export default function CyclesPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: cycles, isLoading } = api.cycle.listByWorkspace.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      status: statusFilter !== "all" ? statusFilter : undefined,
    },
    { enabled: !!workspace?.id }
  );

  const { data: teams } = api.team.list.useQuery(
    { workspaceId: workspace?.id ?? "" },
    { enabled: !!workspace?.id }
  );

  const activeCycles = cycles?.filter((c) => c.status === "active") ?? [];
  const upcomingCycles = cycles?.filter((c) => c.status === "upcoming") ?? [];
  const completedCycles = cycles?.filter((c) => c.status === "completed") ?? [];

  const filteredCycles =
    statusFilter === "all"
      ? cycles
      : cycles?.filter((c) => c.status === statusFilter);

  const handleCycleClick = (cycleId: string) => {
    router.push(`/dashboard/${workspaceSlug}/cycles/${cycleId}`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <RefreshCw className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Cycles</h1>
              <p className="text-sm text-muted-foreground">
                Plan and track work across sprints
              </p>
            </div>
          </div>
          <Button size="sm" disabled={!teams || teams.length === 0}>
            <Plus className="mr-1 h-4 w-4" />
            New Cycle
          </Button>
        </div>

        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="all">
              All
              {cycles && <span className="ml-1.5 text-xs">({cycles.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="active">
              Active
              {activeCycles.length > 0 && (
                <span className="ml-1.5 text-xs">({activeCycles.length})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="upcoming">
              Upcoming
              {upcomingCycles.length > 0 && (
                <span className="ml-1.5 text-xs">({upcomingCycles.length})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed
              {completedCycles.length > 0 && (
                <span className="ml-1.5 text-xs">({completedCycles.length})</span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !filteredCycles || filteredCycles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <RefreshCw className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-medium">No cycles found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {statusFilter === "all"
                ? "Create your first cycle to start tracking sprints."
                : `No ${statusFilter} cycles.`}
            </p>
            {statusFilter === "all" && teams && teams.length > 0 && (
              <Button size="sm" className="mt-4">
                <Plus className="mr-1 h-4 w-4" />
                Create Cycle
              </Button>
            )}
            {(!teams || teams.length === 0) && (
              <p className="mt-2 text-xs text-muted-foreground">
                You need to be a member of a team to create cycles.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCycles.map((cycle) => (
              <CycleCard
                key={cycle.id}
                cycle={cycle as Cycle}
                onClick={() => handleCycleClick(cycle.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
