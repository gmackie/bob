"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { Button } from "@linear-clone/ui/components/button";
import { Home, Plus, Command } from "lucide-react";
import { InProgressWidget } from "@/components/dashboard/in-progress-widget";
import { DueSoonWidget } from "@/components/dashboard/due-soon-widget";
import { RecentlyCompletedWidget } from "@/components/dashboard/recently-completed-widget";
import { CompletionTrendWidget } from "@/components/dashboard/completion-trend-widget";
import { CompletionByProjectWidget } from "@/components/dashboard/completion-by-project-widget";
import { cn } from "@linear-clone/ui/lib/utils";

type DateRange = "today" | "week" | "14days";

export default function DashboardHomePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceSlug = params.workspaceSlug as string;
  const [dateRange, setDateRange] = useState<DateRange>("week");

  const { data: workspace } = api.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug }
  );

  const { data: dashboardData, isLoading } = api.issue.dashboard.useQuery(
    {
      workspaceId: workspace?.id ?? "",
      dateRange,
    },
    { enabled: !!workspace?.id }
  );

  const handleCreateTask = () => {
    router.push(`/dashboard/${workspaceSlug}/tasks/all?new=true`);
  };

  const handleOpenCommandPalette = () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Home className="h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold">Home</h1>
              <p className="text-sm text-muted-foreground">
                Your personal dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-muted rounded-md p-0.5">
              {(["today", "week", "14days"] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded transition-colors",
                    dateRange === range
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {range === "today" ? "Today" : range === "week" ? "This Week" : "14 Days"}
                </button>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={handleOpenCommandPalette}>
              <Command className="h-3 w-3 mr-1" />K
            </Button>

            <Button size="sm" onClick={handleCreateTask}>
              <Plus className="h-4 w-4 mr-1" />
              New Task
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 space-y-6">
            <InProgressWidget
              tasks={dashboardData?.inProgress ?? []}
              workspaceSlug={workspaceSlug}
              isLoading={isLoading}
            />

            <DueSoonWidget
              overdue={dashboardData?.overdue ?? []}
              dueSoon={dashboardData?.dueSoon ?? []}
              dueThisWeek={dashboardData?.dueThisWeek ?? []}
              workspaceSlug={workspaceSlug}
              isLoading={isLoading}
            />

            <RecentlyCompletedWidget
              tasks={dashboardData?.recentlyCompleted ?? []}
              workspaceSlug={workspaceSlug}
              isLoading={isLoading}
              dateRange={dateRange}
            />
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-6">
            <CompletionTrendWidget
              data={dashboardData?.stats.completionTrend ?? []}
              isLoading={isLoading}
            />

            <CompletionByProjectWidget
              data={dashboardData?.stats.completionByProject ?? []}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
