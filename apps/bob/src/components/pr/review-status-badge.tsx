"use client";

interface ReviewStatusBadgeProps {
  status: "pending" | "approved" | "changes_requested" | "failed" | null;
}

const STATUS_STYLES = {
  pending:
    "bg-[#E3E1DC] text-[#8A877E] dark:bg-[#232220] dark:text-[#6E6B64]",
  approved:
    "bg-[#E8F5E9] text-[#2D8A4E] dark:bg-[#1B2E1D] dark:text-[#4CAF50]",
  changes_requested:
    "bg-[#FFF3E0] text-[#D4850A] dark:bg-[#2C2418] dark:text-[#E8A33C]",
  failed:
    "bg-[#FFEBEE] text-[#C62828] dark:bg-[#2E1616] dark:text-[#EF5350]",
} as const;

const STATUS_LABELS = {
  pending: "AWAITING REVIEW",
  approved: "APPROVED",
  changes_requested: "CHANGES REQUESTED",
  failed: "REVIEW FAILED",
} as const;

export function ReviewStatusBadge({ status }: ReviewStatusBadgeProps) {
  if (!status) return null;

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold tracking-[0.04em] uppercase ${STATUS_STYLES[status]}`}
      role="status"
      aria-label={`Review status: ${STATUS_LABELS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
