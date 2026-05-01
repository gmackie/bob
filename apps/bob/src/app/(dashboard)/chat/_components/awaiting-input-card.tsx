"use client";

import { useCallback, useEffect, useState } from "react";

import { cn } from "@gmacko/core/ui";

interface AwaitingInputCardProps {
  question: string;
  options: string[] | null;
  defaultAction: string;
  expiresAt: string;
  onResolve: (response: string) => void;
  isResolving: boolean;
}

function useCountdown(expiresAt: string) {
  const [remaining, setRemaining] = useState(() => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  });

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      const secs = Math.max(0, Math.ceil(ms / 1000));
      setRemaining(secs);
      if (secs <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, remaining]);

  return remaining;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function AwaitingInputCard({
  question,
  options,
  defaultAction,
  expiresAt,
  onResolve,
  isResolving,
}: AwaitingInputCardProps) {
  const [customInput, setCustomInput] = useState("");
  const remaining = useCountdown(expiresAt);
  const expired = remaining <= 0;

  const handleOption = useCallback(
    (opt: string) => {
      if (isResolving || expired) return;
      onResolve(opt);
    },
    [onResolve, isResolving, expired],
  );

  const handleCustom = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed || isResolving || expired) return;
    onResolve(trimmed);
    setCustomInput("");
  }, [customInput, onResolve, isResolving, expired]);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-primary">
          Input required
        </span>
        <span
          className={cn(
            "text-[10px] tabular-nums",
            remaining <= 30 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {formatCountdown(remaining)}
        </span>
      </div>

      <p className="text-sm text-foreground">{question}</p>

      {options && options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => handleOption(opt)}
              disabled={isResolving || expired}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Free-text input for custom responses */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCustom()}
          placeholder="Or type a response..."
          disabled={isResolving || expired}
          className="flex-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          onClick={handleCustom}
          disabled={isResolving || expired || !customInput.trim()}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reply
        </button>
      </div>

      {defaultAction && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Default: {defaultAction}
        </p>
      )}
    </div>
  );
}
