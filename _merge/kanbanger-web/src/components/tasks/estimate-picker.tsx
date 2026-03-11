"use client";

import { useState, useRef, useEffect } from "react";
import { Clock, X } from "lucide-react";
import { cn } from "@linear-clone/ui/lib/utils";

const ESTIMATE_OPTIONS = [
  { label: "XS", value: 1, description: "< 1 hour" },
  { label: "S", value: 2, description: "1-2 hours" },
  { label: "M", value: 3, description: "Half day" },
  { label: "L", value: 5, description: "1 day" },
  { label: "XL", value: 8, description: "2-3 days" },
  { label: "XXL", value: 13, description: "1 week" },
] as const;

interface EstimatePickerProps {
  value?: number | null;
  onChange?: (estimate: number | null) => void;
  disabled?: boolean;
  className?: string;
}

export function EstimatePicker({
  value,
  onChange,
  disabled,
  className,
}: EstimatePickerProps) {
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

  const selectedOption = ESTIMATE_OPTIONS.find((opt) => opt.value === value);

  const handleSelect = (estimate: number | null) => {
    onChange?.(estimate);
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
        <Clock className="h-4 w-4 text-muted-foreground" />
        {selectedOption ? (
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded px-1 text-xs font-semibold",
                getEstimateColor(selectedOption.value)
              )}
            >
              {selectedOption.label}
            </span>
            <span className="text-muted-foreground">
              {selectedOption.value} pts
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Add estimate</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Estimate
          </div>

          {ESTIMATE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={cn(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm transition-colors",
                "hover:bg-muted focus:bg-muted focus:outline-none",
                value === option.value && "bg-muted"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded px-1 text-xs font-semibold",
                    getEstimateColor(option.value)
                  )}
                >
                  {option.label}
                </span>
                <span className="text-muted-foreground">
                  {option.description}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {option.value} pts
              </span>
            </button>
          ))}

          {value !== null && value !== undefined && (
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
                Clear estimate
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function getEstimateColor(value: number): string {
  if (value <= 1) return "bg-green-500/10 text-green-600 dark:text-green-400";
  if (value <= 2) return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (value <= 3) return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
  if (value <= 5) return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
  if (value <= 8) return "bg-red-500/10 text-red-600 dark:text-red-400";
  return "bg-purple-500/10 text-purple-600 dark:text-purple-400";
}

export { ESTIMATE_OPTIONS };

export function getEstimateLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "No estimate";
  const option = ESTIMATE_OPTIONS.find((opt) => opt.value === value);
  return option ? `${option.label} (${value} pts)` : `${value} pts`;
}
