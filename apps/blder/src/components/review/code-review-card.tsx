// apps/web/src/components/review/code-review-card.tsx
"use client";

import { cn } from "@bob/ui";

interface ReviewComment {
  file: string;
  line?: string;
  severity: "critical" | "suggestion" | "nit";
  body: string;
  diffContext?: string;
  resolution?: "applied" | "acknowledged" | null;
}

export interface CodeReviewData {
  decision: "approve" | "request_changes";
  summary: string;
  comments: ReviewComment[];
  reviewerName?: string;
  reviewedAt?: string;
  sessionId?: string;
  iteration?: number;
  isAgentFixing?: boolean;
}

interface CodeReviewCardProps {
  review: CodeReviewData;
  workItemIdentifier: string;
  taskLabel?: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  suggestion: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  nit: "bg-muted text-muted-foreground",
};

const RESOLUTION_STYLE: Record<string, { label: string; className: string }> = {
  applied: { label: "Applied", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  acknowledged: { label: "Acknowledged", className: "bg-muted text-muted-foreground" },
};

export function CodeReviewCard({ review, workItemIdentifier, taskLabel }: CodeReviewCardProps) {
  const isApproved = review.decision === "approve";

  return (
    <section id="section-review" className={cn(
      "rounded-2xl border bg-card overflow-hidden",
      isApproved ? "border-emerald-500/30" : "border-rose-500/30",
    )}>
      {/* Header */}
      <div className={cn(
        "flex items-center gap-3 px-5 py-4 border-b",
        isApproved ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5",
      )}>
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg text-lg",
          isApproved ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400",
        )}>
          {isApproved ? "\u2713" : "\u2715"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-sm font-semibold text-foreground">
            Code Review{taskLabel ? `: ${taskLabel}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{workItemIdentifier}</span>
            {review.reviewerName && <> · reviewed by <strong>{review.reviewerName}</strong></>}
            {review.reviewedAt && <> · {new Date(review.reviewedAt).toLocaleTimeString()}</>}
            {" · "}
            <span className={cn("font-semibold", isApproved ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
              {isApproved ? "APPROVED" : "CHANGES REQUESTED"}
            </span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="px-5 py-4">
        <div className={cn(
          "rounded-lg px-4 py-3 text-sm text-secondary-foreground leading-relaxed",
          isApproved ? "bg-muted" : "bg-rose-500/5 border border-rose-500/10",
        )}>
          {review.summary}
        </div>
      </div>

      {/* Comments */}
      {review.comments.length > 0 && (
        <div className="px-5 pb-4 space-y-3">
          {review.comments.map((comment, i) => (
            <div key={i} className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-xs border-b border-border">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">B</div>
                <span className="font-medium text-foreground">{review.reviewerName ?? "bob-reviewer"}</span>
                <span className="font-mono text-muted-foreground">{comment.file}</span>
                {comment.line && <span className="font-mono text-primary">{comment.line}</span>}
                <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold", SEVERITY_STYLE[comment.severity])}>
                  {comment.severity}
                </span>
              </div>
              {comment.diffContext && (
                <div className="border-b border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {comment.diffContext}
                </div>
              )}
              <div className="px-3 py-3 text-sm text-foreground leading-relaxed">
                {comment.body}
                {comment.resolution && (
                  <div className="mt-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", RESOLUTION_STYLE[comment.resolution]?.className)}>
                      {RESOLUTION_STYLE[comment.resolution]?.label}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className={cn(
        "flex items-center justify-between px-5 py-3 border-t bg-muted/30",
        !isApproved && "bg-rose-500/5 border-rose-500/10",
      )}>
        <span className="text-xs text-muted-foreground">
          {review.comments.length} comment{review.comments.length !== 1 ? "s" : ""}
          {review.comments.filter(c => c.resolution === "applied").length > 0 &&
            ` · ${review.comments.filter(c => c.resolution === "applied").length} applied`}
        </span>
        {!isApproved && review.isAgentFixing && (
          <div className="flex items-center gap-2">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Agent fixing{review.iteration ? ` — iteration ${review.iteration}` : ""}...
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
