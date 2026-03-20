"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@bob/ui";

interface ResizableSplitViewProps {
  left: React.ReactNode;
  right: React.ReactNode;
  storageKey?: string;
  defaultRatio?: number; // 0-1, default 0.6 (60% left)
  minRatio?: number; // default 0.25
  maxRatio?: number; // default 0.75
  className?: string;
}

export function ResizableSplitView({
  left,
  right,
  storageKey = "split-view-ratio",
  defaultRatio = 0.6,
  minRatio = 0.25,
  maxRatio = 0.75,
  className,
}: ResizableSplitViewProps) {
  const [ratio, setRatio] = useState(() => {
    if (typeof window === "undefined") return defaultRatio;
    const stored = localStorage.getItem(storageKey);
    return stored ? Math.min(maxRatio, Math.max(minRatio, parseFloat(stored))) : defaultRatio;
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = Math.min(maxRatio, Math.max(minRatio, (e.clientX - rect.left) / rect.width));
      setRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem(storageKey, ratio.toString());
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, maxRatio, minRatio, ratio, storageKey]);

  return (
    <div
      ref={containerRef}
      className={cn("flex h-full", isDragging && "select-none", className)}
    >
      {/* Left panel */}
      <div
        role="region"
        aria-label="Chat"
        className="flex flex-col overflow-hidden"
        style={{ width: `${ratio * 100}%` }}
      >
        {left}
      </div>

      {/* Resizable divider */}
      <div
        role="separator"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-orientation="vertical"
        tabIndex={0}
        className={cn(
          "relative w-1 cursor-col-resize flex-shrink-0 transition-colors",
          isDragging ? "bg-primary" : "bg-border hover:bg-primary/30",
        )}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setRatio((r) => Math.max(minRatio, r - 0.01));
          if (e.key === "ArrowRight") setRatio((r) => Math.min(maxRatio, r + 0.01));
        }}
      >
        {/* Grip dots */}
        <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 flex-col items-center justify-center gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div
        role="region"
        aria-label="Artifact preview"
        className="flex flex-1 flex-col overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
}
