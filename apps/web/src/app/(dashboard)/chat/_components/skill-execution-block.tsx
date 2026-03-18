"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@bob/ui";

export interface SkillFinding {
  type: string;
  severity: string;
  message: string;
  autoFixed?: boolean;
}

export interface SkillExecutionBlockProps {
  executionId?: string;
  skillSlug: string;
  skillName?: string;
  category?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  findings?: SkillFinding[];
  durationMs?: number;
  childExecutions?: SkillExecutionBlockProps[];
  onReplay?: (executionId: string) => void;
}

const categoryBorderColor: Record<string, string> = {
  planning: "border-l-amber-500",
  execution: "border-l-blue-500",
  review: "border-l-purple-500",
  deploy: "border-l-emerald-500",
  ops: "border-l-slate-500",
};

const categoryBadgeBg: Record<string, string> = {
  planning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  execution: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  review: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  deploy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  ops: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
};

function statusDotClass(status: SkillExecutionBlockProps["status"]) {
  switch (status) {
    case "running":
      return "bg-blue-500 animate-pulse";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-rose-500";
    case "cancelled":
      return "bg-slate-400";
  }
}

function statusLabel(status: SkillExecutionBlockProps["status"]) {
  switch (status) {
    case "running":
      return "Running...";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function severityIcon(severity: string): ReactNode {
  switch (severity) {
    case "pass":
    case "ok":
    case "info":
      return <span className="text-emerald-600 dark:text-emerald-400">&#10003;</span>;
    case "warning":
    case "warn":
      return <span className="text-amber-600 dark:text-amber-400">&#9888;</span>;
    case "error":
    case "fail":
    case "critical":
      return <span className="text-rose-600 dark:text-rose-400">&#10007;</span>;
    default:
      return <span className="text-slate-500">&#8226;</span>;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function findingSummary(findings: SkillFinding[]): string {
  const issues = findings.filter(
    (f) => f.severity !== "pass" && f.severity !== "ok" && f.severity !== "info",
  );
  const autoFixed = issues.filter((f) => f.autoFixed).length;
  if (issues.length === 0) return "No issues found";
  const parts = [`${issues.length} issue${issues.length === 1 ? "" : "s"} found`];
  if (autoFixed > 0) {
    parts.push(`${autoFixed} auto-fixed`);
  }
  return parts.join(", ");
}

function FindingsList({ findings }: { findings: SkillFinding[] }) {
  return (
    <ul className="space-y-1">
      {findings.map((finding, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 flex-shrink-0">
            {severityIcon(finding.severity)}
          </span>
          <span className="text-[var(--neutral-800)] dark:text-[var(--neutral-200)]">
            <span className="font-medium">{finding.type}:</span>{" "}
            {finding.message}
          </span>
          {finding.autoFixed && (
            <span className="ml-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              AUTO-FIXED
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SkillExecutionBlock(props: SkillExecutionBlockProps) {
  const {
    executionId,
    skillSlug,
    skillName,
    category,
    status,
    findings,
    durationMs,
    output,
    childExecutions,
    onReplay,
  } = props;

  const [expanded, setExpanded] = useState(status !== "completed");

  const borderColor = category
    ? categoryBorderColor[category] ?? "border-l-slate-400"
    : "border-l-slate-400";

  const isFailed = status === "failed";
  const findingsList: SkillFinding[] = findings ?? [];
  const hasFindings = findingsList.length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border-l-4 my-3 overflow-hidden",
        "border border-[var(--neutral-200)] dark:border-[var(--neutral-700)]",
        "bg-white dark:bg-[#1C1B18]",
        borderColor,
        isFailed && "border-l-rose-500",
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-3 text-left",
          "hover:bg-[var(--neutral-50)] dark:hover:bg-[#232220]",
          "transition-colors duration-150",
        )}
      >
        <span className="font-mono text-sm font-semibold text-[var(--neutral-900)] dark:text-[var(--neutral-100)]">
          /{skillSlug}
        </span>

        {skillName && (
          <span className="text-sm text-[var(--neutral-500)] dark:text-[var(--neutral-400)] hidden sm:inline">
            {skillName}
          </span>
        )}

        {category && (
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              categoryBadgeBg[category] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            {category}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 text-xs text-[var(--neutral-500)]">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              statusDotClass(status),
            )}
          />
          <span>{statusLabel(status)}</span>
          {durationMs != null && (
            <span className="tabular-nums">{formatDuration(durationMs)}</span>
          )}
          <span className="text-[var(--neutral-400)]">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        </span>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {/* Findings list */}
          {hasFindings && (
            <FindingsList findings={findingsList} />
          )}

          {/* Error output for failed state */}
          {isFailed && output?.error != null && (
            <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">
              {String(output.error)}
            </div>
          )}

          {/* Nested skill executions */}
          {childExecutions && childExecutions.length > 0 && (
            <div className="ml-4">
              {childExecutions.map((child, i) => (
                <SkillExecutionBlock key={`${child.skillSlug}-${i}`} {...child} />
              ))}
            </div>
          )}

          {/* Footer summary */}
          {hasFindings && status !== "running" && (
            <div className="pt-1 border-t border-[var(--neutral-100)] dark:border-[var(--neutral-700)] text-xs text-[var(--neutral-500)] dark:text-[var(--neutral-400)]">
              Result: {findingSummary(findingsList)}
            </div>
          )}

          {/* Replay button — only on completed/failed executions with an ID */}
          {executionId && status !== "running" && onReplay && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onReplay(executionId)}
                className={cn(
                  "text-xs font-medium px-2 py-1 rounded",
                  "text-primary hover:bg-primary/10",
                  "transition-colors duration-150",
                )}
              >
                Replay
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
