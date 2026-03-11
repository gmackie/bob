"use client";

import { AlertCircle, Bot, CheckCircle2, FlaskConical, GitPullRequest, SearchCheck, XCircle } from "lucide-react";

import { cn } from "@linear-clone/ui/lib/utils";

export interface BobTaskProjection {
  hasActiveRun: boolean;
  needsInput: boolean;
  inReview: boolean;
  hasPr: boolean;
  verificationStatus: "passed" | "failed" | "available" | null;
  latestSummary?: string | null;
}

interface BobIndicatorTask {
  bobView?: BobTaskProjection | null;
}

function getVerificationLabel(status: BobTaskProjection["verificationStatus"]) {
  switch (status) {
    case "passed":
      return "Verified";
    case "failed":
      return "Checks failed";
    case "available":
      return "Checks";
    default:
      return null;
  }
}

function getAttentionScore(task: BobIndicatorTask) {
  const bobView = task.bobView;
  if (!bobView) return 100;
  if (bobView.needsInput) return 0;
  if (bobView.inReview) return 1;
  if (bobView.hasActiveRun) return 2;
  if (bobView.hasPr || bobView.verificationStatus) return 3;
  return 10;
}

export function sortTasksForBobAttention<T extends BobIndicatorTask>(tasks: T[]) {
  return [...tasks].sort((left, right) => getAttentionScore(left) - getAttentionScore(right));
}

export function BobTaskIndicators({
  bobView,
  compact = false,
  onClick,
}: {
  bobView?: BobTaskProjection | null;
  compact?: boolean;
  onClick?: () => void;
}) {
  if (!bobView) {
    return null;
  }

  const verificationLabel = getVerificationLabel(bobView.verificationStatus);
  const chipClassName = compact
    ? "rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-medium"
    : "rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="flex flex-wrap items-center gap-1 text-left"
      title={bobView.latestSummary ?? "Open Bob context"}
    >
      <span className={cn(chipClassName, "inline-flex items-center gap-1 text-sky-700")}>
        <Bot className="h-3 w-3" />
        Bob
      </span>
      {bobView.needsInput ? (
        <span className={cn(chipClassName, "inline-flex items-center gap-1 text-amber-700")}>
          <AlertCircle className="h-3 w-3" />
          Needs input
        </span>
      ) : null}
      {bobView.inReview ? (
        <span className={cn(chipClassName, "inline-flex items-center gap-1 text-indigo-700")}>
          <SearchCheck className="h-3 w-3" />
          In review
        </span>
      ) : null}
      {bobView.hasPr ? (
        <span className={cn(chipClassName, "inline-flex items-center gap-1 text-emerald-700")}>
          <GitPullRequest className="h-3 w-3" />
          PR
        </span>
      ) : null}
      {verificationLabel ? (
        <span
          className={cn(
            chipClassName,
            "inline-flex items-center gap-1",
            bobView.verificationStatus === "failed" ? "text-red-700" : "text-emerald-700",
          )}
        >
          {bobView.verificationStatus === "failed" ? (
            <XCircle className="h-3 w-3" />
          ) : bobView.verificationStatus === "passed" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <FlaskConical className="h-3 w-3" />
          )}
          {verificationLabel}
        </span>
      ) : null}
    </button>
  );
}
