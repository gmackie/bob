"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@linear-clone/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@linear-clone/ui/components/tabs";
import { Clock } from "lucide-react";
import { TaskRow } from "./task-row";
import { cn } from "@linear-clone/ui/lib/utils";

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

interface DueSoonWidgetProps {
  overdue: Task[];
  dueSoon: Task[];
  dueThisWeek: Task[];
  workspaceSlug: string;
  isLoading?: boolean;
}

export function DueSoonWidget({
  overdue,
  dueSoon,
  dueThisWeek,
  workspaceSlug,
  isLoading,
}: DueSoonWidgetProps) {
  const [activeTab, setActiveTab] = useState(overdue.length > 0 ? "overdue" : "soon");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <Clock className="h-4 w-4 text-orange-500" />
          Due Dates
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-3 mb-3">
            <TabsTrigger value="overdue" className="relative">
              Overdue
              {overdue.length > 0 && (
                <span className={cn(
                  "ml-1 px-1.5 py-0.5 text-[10px] rounded-full",
                  "bg-red-500 text-white"
                )}>
                  {overdue.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="soon">
              Next 3d
              {dueSoon.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {dueSoon.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="week">
              This week
              {dueThisWeek.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {dueThisWeek.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 bg-muted/50 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <TabsContent value="overdue" className="mt-0">
                {overdue.length > 0 ? (
                  <div className="space-y-1">
                    {overdue.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        workspaceSlug={workspaceSlug}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No overdue tasks
                  </p>
                )}
              </TabsContent>

              <TabsContent value="soon" className="mt-0">
                {dueSoon.length > 0 ? (
                  <div className="space-y-1">
                    {dueSoon.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        workspaceSlug={workspaceSlug}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No tasks due in the next 3 days
                  </p>
                )}
              </TabsContent>

              <TabsContent value="week" className="mt-0">
                {dueThisWeek.length > 0 ? (
                  <div className="space-y-1">
                    {dueThisWeek.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        workspaceSlug={workspaceSlug}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No tasks due this week
                  </p>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
