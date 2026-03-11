"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui/components/card";
import { PlayCircle } from "lucide-react";
import { TaskRow } from "./task-row";

interface Task {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: Date | string | null;
  project?: {
    id: string;
    name: string;
    key: string;
    color: string | null;
  } | null;
}

interface InProgressWidgetProps {
  tasks: Task[];
  workspaceSlug: string;
  isLoading?: boolean;
}

export function InProgressWidget({ tasks, workspaceSlug, isLoading }: InProgressWidgetProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <PlayCircle className="h-4 w-4 text-blue-500" />
          In Progress
          {tasks.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">
              {tasks.length}
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
        ) : tasks.length > 0 ? (
          <div className="space-y-1">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                workspaceSlug={workspaceSlug}
                showStatus={false}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No tasks in progress
          </p>
        )}
      </CardContent>
    </Card>
  );
}
