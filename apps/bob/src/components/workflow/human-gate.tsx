"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

interface HumanGateProps {
  question: string;
  options: string[];
  onResolve: (answer: string) => void;
  expiresAt?: string;
}

export function HumanGate({
  question,
  options,
  onResolve,
  expiresAt,
}: HumanGateProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const [resolved, setResolved] = useState(false);

  const expiresDate = useMemo(
    () => (expiresAt ? new Date(expiresAt) : null),
    [expiresAt],
  );

  const isExpired = expiresDate ? expiresDate < new Date() : false;

  useEffect(() => {
    if (!expiresDate) return;

    const updateTime = () => {
      const now = new Date();
      const diff = expiresDate.getTime() - now.getTime();
      if (diff <= 0) {
        setTimeRemaining("Expired");
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeRemaining(`${minutes}m ${seconds}s`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [expiresDate]);

  function handleResolve(answer: string) {
    if (resolved || isExpired) return;
    setResolved(true);
    onResolve(answer);
  }

  return (
    <div className="border-primary/30 bg-primary/5 rounded-2xl p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-primary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span className="font-display text-sm font-bold text-foreground">
            Decision Required
          </span>
        </div>
        {expiresDate && !isExpired && (
          <span className="text-xs font-medium text-muted-foreground">
            {timeRemaining} remaining
          </span>
        )}
        {isExpired && (
          <span className="text-xs font-medium text-destructive">
            Expired
          </span>
        )}
      </div>

      {/* Question */}
      <p className="mb-6 text-sm leading-relaxed text-foreground">
        {question}
      </p>

      {/* Options */}
      <div
        className={cn(
          "flex flex-wrap gap-3",
          (resolved || isExpired) && "pointer-events-none opacity-50",
        )}
      >
        {options.map((option) => (
          <Button
            key={option}
            variant="outline"
            size="sm"
            onClick={() => handleResolve(option)}
            disabled={resolved || isExpired}
            className="border-primary/20 hover:bg-primary/10 hover:text-primary"
          >
            {option}
          </Button>
        ))}
      </div>

      {resolved && (
        <p className="mt-4 text-xs text-muted-foreground">
          Response submitted.
        </p>
      )}
    </div>
  );
}
