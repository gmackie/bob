"use client";

import { useEffect, useMemo, useState } from "react";

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

  const expiresDate = useMemo(() => new Date(expiresAt), [expiresAt]);
  const isExpired = expiresDate < new Date();
  const isCustomResponseReady = customResponse.trim().length > 0;
  const cardState = isExpired ? "expired" : "active";
  const isSubmitDisabled = isResolving ? true : !isCustomResponseReady;

  useEffect(() => {
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

  const handleOptionClick = (option: string) => {
    if (onResolve && !isResolving) {
      onResolve(option);
    }
  };

  const handleCustomSubmit = () => {
    if (onResolve && !isResolving && customResponse.trim()) {
      onResolve(customResponse.trim());
      setCustomResponse("");
    }
  };

  return (
    <div
      data-testid="awaiting-input-card"
      data-expired={isExpired}
      className={cn(
        "chat-awaitingInputCard",
        `chat-awaitingInputCard--${cardState}`,
      )}
    >
      <div className="chat-awaitingInputCardHeader">
        <div className="chat-awaitingInputCardHeaderTitle">
          <svg
            className={cn("chat-awaitingInputCardIcon", isExpired && "is-expired")}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-14a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          </svg>
          <span className="chat-awaitingInputCardTitle">
            {isExpired ? "Input Expired" : "Agent Needs Input"}
          </span>
        </div>
        {!isExpired && (
          <span
            data-testid="time-remaining"
            className="chat-awaitingInputCardRemaining"
          >
            {timeRemaining} remaining
          </span>
        )}
      </div>

      <p
        data-testid="input-question"
        className="chat-awaitingInputCardQuestion"
      >
        {question}
      </p>

      {options && options.length > 0 && !isExpired && (
        <div
          data-testid="input-options"
          className="chat-awaitingInputCardOptions"
        >
          {options.map((option, idx) => (
            <Button
              key={idx}
              data-testid={`input-option-${idx}`}
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => handleOptionClick(option)}
              className="chat-awaitingInputOptionButton"
            >
              {option}
            </Button>
          ))}
        </div>
      )}

      {!isExpired && (
        <div
          data-testid="custom-response-section"
          className="chat-awaitingInputCustom"
        >
          <input
            type="text"
            data-testid="custom-response-input"
            aria-label="Custom response input"
            value={customResponse}
            onChange={(e) => setCustomResponse(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isSubmitDisabled) {
                e.preventDefault();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomSubmit();
              }
            }}
            placeholder="Or type a custom response..."
            disabled={isResolving}
            className="chat-awaitingInputField"
          />
          <Button
            size="sm"
            data-testid="custom-response-submit"
            className="chat-awaitingInputSubmit"
            disabled={isSubmitDisabled}
            onClick={handleCustomSubmit}
          >
            {isResolving ? "Sending..." : "Send"}
          </Button>
        </div>
      )}

      <div
        data-testid="default-action-info"
        className={cn(
          "chat-awaitingInputCardDefaultAction",
          isExpired ? "is-expired" : "is-active",
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
      className={cn(
        "chat-resolvedInputCard",
        `chat-resolvedInputCard--${resolution.type}`,
      )}
    >
      <div className="chat-resolvedInputCardHeader">
        <svg
          className={cn(
            "chat-resolvedInputCardIcon",
            resolution.type === "human" ? "is-human" : "is-timeout",
          )}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        <span
          data-testid="resolution-type-label"
          className="chat-resolvedInputCardTitle"
        >
          {resolution.type === "human"
            ? "Human Response"
            : "Auto-resolved (timeout)"}
        </span>
      </div>
      <p
        data-testid="resolved-question"
        className="chat-resolvedInputCardQuestion"
      >
        Q: {question}
      </p>
      <p
        data-testid="resolved-answer"
        className="chat-resolvedInputCardAnswer"
      >
        A: {resolution.value}
      </p>
    </div>
  );
}
