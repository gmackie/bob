"use client";

import { useState, useRef, useEffect } from "react";
import { RefreshCw, X, Check, PlayCircle, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";

type CycleStatus = "upcoming" | "active" | "completed";

interface Cycle {
  id: string;
  name: string | null;
  number: number;
  status: CycleStatus;
  startDate: Date;
  endDate: Date;
  team?: {
    id: string;
    name: string;
    key: string | null;
    color: string | null;
  };
}

interface CyclePickerProps {
  value?: string | null;
  cycles: Cycle[];
  isLoading?: boolean;
  onChange?: (cycleId: string | null) => void;
  disabled?: boolean;
  className?: string;
}

function getStatusIcon(status: CycleStatus) {
  switch (status) {
    case "active":
      return <PlayCircle className="h-3.5 w-3.5 text-green-500" />;
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />;
    case "upcoming":
      return <Clock className="h-3.5 w-3.5 text-yellow-500" />;
    default:
      return null;
  }
}

function formatDateRange(start: Date, end: Date) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${startDate.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`;
}

export function CyclePicker({
  value,
  cycles,
  isLoading,
  onChange,
  disabled,
  className,
}: CyclePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  const selectedCycle = cycles.find((c) => c.id === value);

  const activeCycles = cycles.filter((c) => c.status === "active");
  const upcomingCycles = cycles.filter((c) => c.status === "upcoming");
  const completedCycles = cycles.filter((c) => c.status === "completed");

  const handleSelect = (cycleId: string | null) => {
    onChange?.(cycleId);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
          "hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <RefreshCw className="h-4 w-4 text-muted-foreground" />
        {selectedCycle ? (
          <span className="flex items-center gap-1.5">
            {getStatusIcon(selectedCycle.status)}
            <span>{selectedCycle.name ?? `Cycle ${selectedCycle.number}`}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No cycle</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : cycles.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No cycles available
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto p-1">
              {activeCycles.length > 0 && (
                <div>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Active
                  </div>
                  {activeCycles.map((cycle) => (
                    <CycleItem
                      key={cycle.id}
                      cycle={cycle}
                      isSelected={value === cycle.id}
                      onSelect={() => handleSelect(cycle.id)}
                    />
                  ))}
                </div>
              )}

              {upcomingCycles.length > 0 && (
                <div>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Upcoming
                  </div>
                  {upcomingCycles.map((cycle) => (
                    <CycleItem
                      key={cycle.id}
                      cycle={cycle}
                      isSelected={value === cycle.id}
                      onSelect={() => handleSelect(cycle.id)}
                    />
                  ))}
                </div>
              )}

              {completedCycles.length > 0 && (
                <div>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Completed
                  </div>
                  {completedCycles.map((cycle) => (
                    <CycleItem
                      key={cycle.id}
                      cycle={cycle}
                      isSelected={value === cycle.id}
                      onSelect={() => handleSelect(cycle.id)}
                    />
                  ))}
                </div>
              )}

              {value && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    onClick={() => handleSelect(null)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors",
                      "hover:bg-muted hover:text-foreground focus:bg-muted focus:outline-none"
                    )}
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove from cycle
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CycleItem({
  cycle,
  isSelected,
  onSelect,
}: {
  cycle: Cycle;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm transition-colors",
        "hover:bg-muted focus:bg-muted focus:outline-none",
        isSelected && "bg-muted"
      )}
    >
      <div className="flex items-center gap-2">
        {getStatusIcon(cycle.status)}
        <div className="text-left">
          <div className="font-medium">
            {cycle.name ?? `Cycle ${cycle.number}`}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatDateRange(cycle.startDate, cycle.endDate)}
          </div>
        </div>
      </div>
      {isSelected && <Check className="h-4 w-4 text-primary" />}
    </button>
  );
}
