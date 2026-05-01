// apps/web/src/components/review/approval-gate-card.tsx
"use client";

import { cn } from "@gmacko/core/ui";
import { Button } from "@gmacko/core/ui/button";

interface EvidenceItem {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface ApprovalGateCardProps {
  commitSha: string;
  imageRef?: string;
  evidence: EvidenceItem[];
  onApprove: () => void;
  onReject?: () => void;
  isApproving: boolean;
}

export function ApprovalGateCard({
  commitSha,
  imageRef,
  evidence,
  onApprove,
  onReject,
  isApproving,
}: ApprovalGateCardProps) {
  return (
    <section id="section-approve">
      <div className="rounded-2xl border border-purple-500 bg-purple-500/5 dark:bg-purple-500/10 px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500 text-xl text-white">
            ⏸
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Production Approval Required
            </h2>
            <div className="mt-1 text-sm text-secondary-foreground">
              Commit{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {commitSha.slice(0, 7)}
              </span>
              {imageRef && (
                <>
                  {" · "}
                  <span className="font-mono text-xs text-muted-foreground">{imageRef}</span>
                </>
              )}
            </div>

            {/* Evidence checklist */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              {evidence.map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium",
                    item.passed
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  <span>{item.passed ? "✓" : "✕"}</span>
                  <span>{item.label}</span>
                  {item.detail && (
                    <span className="text-muted-foreground font-normal">{item.detail}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-5 flex gap-3">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={onApprove}
                disabled={isApproving}
              >
                {isApproving ? "Approving..." : "✓ Approve Production Deploy"}
              </Button>
              <Button variant="outline" size="default">
                View Full Report
              </Button>
              {onReject && (
                <Button variant="destructive" size="default" onClick={onReject}>
                  ✕ Reject
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
