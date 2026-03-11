"use client";

import { cn } from "@linear-clone/ui/lib/utils";
import { Progress } from "@linear-clone/ui/components/progress";
import { Calendar, Clock, CheckCircle2, Circle } from "lucide-react";

interface CycleCardProps {
  cycle: {
    id: string;
    name: string;
    description?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    issueCount?: number;
    completedCount?: number;
  };
  isActive?: boolean;
  onClick?: () => void;
}

export function CycleCard({ cycle, isActive = false, onClick }: CycleCardProps) {
  const progress = cycle.issueCount
    ? Math.round(((cycle.completedCount ?? 0) / cycle.issueCount) * 100)
    : 0;

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const getStatus = () => {
    if (!cycle.startDate || !cycle.endDate) return "upcoming";
    const now = new Date();
    const start = new Date(cycle.startDate);
    const end = new Date(cycle.endDate);
    if (now < start) return "upcoming";
    if (now > end) return "completed";
    return "active";
  };

  const status = getStatus();

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border border-border p-4 transition-colors hover:bg-muted/50",
        isActive && "border-primary bg-primary/5"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {status === "completed" ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : status === "active" ? (
              <Clock className="h-4 w-4 text-blue-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <h3 className="font-medium">{cycle.name}</h3>
          </div>
          {cycle.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {cycle.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {/* Dates */}
        {(cycle.startDate || cycle.endDate) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>
              {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
            </span>
          </div>
        )}

        {/* Progress */}
        {cycle.issueCount !== undefined && cycle.issueCount > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span>
                {cycle.completedCount ?? 0} / {cycle.issueCount} issues
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {cycle.issueCount === 0 && (
          <p className="text-xs text-muted-foreground">No issues in this cycle</p>
        )}
      </div>
    </div>
  );
}
