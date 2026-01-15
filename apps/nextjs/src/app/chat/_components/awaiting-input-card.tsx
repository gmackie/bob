"use client";

import { useState } from "react";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

interface AwaitingInputCardProps {
  question: string;
  options?: string[] | null;
  defaultAction: string;
  expiresAt: string;
  onResolve?: (response: string) => void;
  isResolving?: boolean;
}

export function AwaitingInputCard({
  question,
  options,
  defaultAction,
  expiresAt,
  onResolve,
  isResolving,
}: AwaitingInputCardProps) {
  const [customResponse, setCustomResponse] = useState("");
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  const expiresDate = new Date(expiresAt);
  const isExpired = expiresDate < new Date();

  useState(() => {
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
  });

  const handleOptionClick = (option: string) => {
    if (onResolve && !isResolving) {
      onResolve(option);
    }
  };

  const handleCustomSubmit = () => {
    if (onResolve && !isResolving && customResponse.trim()) {
      onResolve(customResponse.trim());
    }
  };

  return (
    <div
      data-testid="awaiting-input-card"
      data-expired={isExpired}
      className={cn(
        "mx-4 my-3 rounded-lg border-2 p-4",
        isExpired
          ? "border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <svg
            className={cn(
              "h-5 w-5",
              isExpired ? "text-gray-500" : "animate-pulse text-amber-500",
            )}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-14a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          </svg>
          <span
            className={cn(
              "text-sm font-medium",
              isExpired
                ? "text-gray-600"
                : "text-amber-700 dark:text-amber-300",
            )}
          >
            {isExpired ? "Input Expired" : "Agent Needs Input"}
          </span>
        </div>
        {!isExpired && (
          <span
            data-testid="time-remaining"
            className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 dark:bg-amber-800 dark:text-amber-200"
          >
            {timeRemaining} remaining
          </span>
        )}
      </div>

      <p
        data-testid="input-question"
        className={cn(
          "mb-4 text-sm",
          isExpired
            ? "text-gray-600 dark:text-gray-400"
            : "text-gray-800 dark:text-gray-200",
        )}
      >
        {question}
      </p>

      {options && options.length > 0 && !isExpired && (
        <div data-testid="input-options" className="mb-4 flex flex-wrap gap-2">
          {options.map((option, idx) => (
            <Button
              key={idx}
              data-testid={`input-option-${idx}`}
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => handleOptionClick(option)}
              className="border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900"
            >
              {option}
            </Button>
          ))}
        </div>
      )}

      {!isExpired && (
        <div
          data-testid="custom-response-section"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            data-testid="custom-response-input"
            value={customResponse}
            onChange={(e) => setCustomResponse(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
            placeholder="Or type a custom response..."
            disabled={isResolving}
            className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:placeholder:text-gray-500"
          />
          <Button
            size="sm"
            data-testid="custom-response-submit"
            disabled={isResolving || !customResponse.trim()}
            onClick={handleCustomSubmit}
          >
            {isResolving ? "Sending..." : "Send"}
          </Button>
        </div>
      )}

      <div
        data-testid="default-action-info"
        className={cn(
          "mt-3 text-xs",
          isExpired ? "text-gray-500" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {isExpired ? (
          <span>Timed out - proceeded with: "{defaultAction}"</span>
        ) : (
          <span>Default action if no response: "{defaultAction}"</span>
        )}
      </div>
    </div>
  );
}

interface ResolvedInputCardProps {
  question: string;
  resolution: {
    type: "human" | "timeout";
    value: string;
  };
}

export function ResolvedInputCard({
  question,
  resolution,
}: ResolvedInputCardProps) {
  return (
    <div
      data-testid="resolved-input-card"
      data-resolution-type={resolution.type}
      className="mx-4 my-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="mb-2 flex items-center gap-2">
        <svg
          className={cn(
            "h-4 w-4",
            resolution.type === "human" ? "text-green-500" : "text-gray-400",
          )}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        <span
          data-testid="resolution-type-label"
          className="text-sm font-medium text-gray-600 dark:text-gray-400"
        >
          {resolution.type === "human"
            ? "Human Response"
            : "Auto-resolved (timeout)"}
        </span>
      </div>
      <p
        data-testid="resolved-question"
        className="mb-2 text-xs text-gray-500 dark:text-gray-500"
      >
        Q: {question}
      </p>
      <p
        data-testid="resolved-answer"
        className="text-sm text-gray-800 dark:text-gray-200"
      >
        A: {resolution.value}
      </p>
    </div>
  );
}
