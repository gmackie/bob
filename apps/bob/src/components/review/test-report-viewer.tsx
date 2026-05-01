// apps/web/src/components/review/test-report-viewer.tsx
"use client";

import { useState } from "react";
import { cn } from "@gmacko/core/ui";

export interface TestCase {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
}

export interface TestSuite {
  name: string;
  file: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests?: TestCase[];
}

export interface TestReportData {
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  durationMs: number;
  suites: TestSuite[];
}

interface TestReportViewerProps {
  report: TestReportData;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function StatCard({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
      <div className={cn("font-display text-2xl font-black tracking-tight", color)}>{value}</div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

export function TestReportViewer({ report }: TestReportViewerProps) {
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

  function toggleSuite(name: string) {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <section id="section-tests">
      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard value={report.totalPassed} label="Passed" color="text-emerald-600 dark:text-emerald-400" />
        <StatCard value={report.totalFailed} label="Failed" color="text-rose-600 dark:text-rose-400" />
        <StatCard value={report.totalSkipped} label="Skipped" color="text-muted-foreground" />
        <StatCard value={formatDuration(report.durationMs)} label="Duration" color="text-foreground" />
      </div>

      {/* Test suites */}
      <div className="space-y-2">
        {report.suites.map((suite) => {
          const isExpanded = expandedSuites.has(suite.name);
          const hasFails = suite.failed > 0;
          return (
            <div key={suite.name} className={cn("rounded-lg border overflow-hidden", hasFails ? "border-rose-500/30" : "border-border")}>
              <button
                type="button"
                onClick={() => suite.tests && toggleSuite(suite.name)}
                className={cn("flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors", suite.tests && "hover:bg-muted/50 cursor-pointer")}
              >
                <span className={cn("text-sm", hasFails ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                  {hasFails ? "\u2715" : "\u2713"}
                </span>
                <span className="flex-1 truncate font-mono text-xs font-medium text-foreground">{suite.file}</span>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  {suite.passed > 0 && <span className="text-emerald-600 dark:text-emerald-400">{suite.passed} pass</span>}
                  {suite.failed > 0 && <span className="text-rose-600 dark:text-rose-400">{suite.failed} fail</span>}
                  {suite.skipped > 0 && <span className="text-muted-foreground">{suite.skipped} skip</span>}
                  <span className="text-muted-foreground">{formatDuration(suite.durationMs)}</span>
                </div>
              </button>
              {isExpanded && suite.tests && (
                <div className="border-t border-border px-3.5 py-2 space-y-1">
                  {suite.tests.map((test, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 text-xs">
                      <span className={cn(
                        "w-4 text-center text-xs",
                        test.status === "passed" ? "text-emerald-600 dark:text-emerald-400" :
                        test.status === "failed" ? "text-rose-600 dark:text-rose-400" :
                        "text-muted-foreground",
                      )}>
                        {test.status === "passed" ? "\u2713" : test.status === "failed" ? "\u2715" : "\u25CB"}
                      </span>
                      <span className="flex-1 text-secondary-foreground">{test.name}</span>
                      {test.durationMs !== undefined && (
                        <span className="font-mono text-[10px] text-muted-foreground">{test.durationMs}ms</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
