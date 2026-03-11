"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui/components/card";
import { CheckCircle2 } from "lucide-react";
import { TaskRow } from "./task-row";
import { isToday } from "date-fns";

interface Task {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  completedAt?: Date | string | null;
  project?: {
    id: string;
    name: string;
    key: string;
    color: string | null;
  } | null;
}

interface RecentlyCompletedWidgetProps {
  tasks: Task[];
  workspaceSlug: string;
  isLoading?: boolean;
  dateRange: "today" | "week" | "14days";
}

export function RecentlyCompletedWidget({
  tasks,
  workspaceSlug,
  isLoading,
  dateRange,
}: RecentlyCompletedWidgetProps) {
  const filteredTasks =
    dateRange === "today"
      ? tasks.filter((t) => t.completedAt && isToday(new Date(t.completedAt)))
      : tasks;

  const label =
    dateRange === "today" ? "Today" : dateRange === "week" ? "This Week" : "Last 14 Days";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          Completed
          <span className="text-xs text-muted-foreground font-normal">
            {label}
          </span>
          {filteredTasks.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">
              ({filteredTasks.length})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredTasks.length > 0 ? (
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                workspaceSlug={workspaceSlug}
                showStatus={false}
                showDueDate={false}
                showCompletedAt={true}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No completed tasks
          </p>
        )}
      </CardContent>
    </Card>
  );
}
