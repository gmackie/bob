"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { safeHref, type CiMessage, type ItemSnapshot } from "@bob/sdlc-view";

import { cn } from "@gmacko/core/ui";

import { CI_STATUS_MARK, tailLines, tailView, type AttemptState } from "./attempt-model";

const CI_TONE: Record<string, string> = {
  passed: "text-emerald-700 dark:text-emerald-400",
  failed: "text-destructive",
  running: "text-amber-700 dark:text-amber-300",
};

/**
 * The attempt level (L5) of an item with an execution: its T3 thread, the live tail the
 * relay streams (last 40 lines, auto-scrolled), and display-only CI phases. `answer` is the
 * pending-input form, drawn above the tail while the agent waits.
 */
export function AttemptView({ item, attempt, answer }: { item: ItemSnapshot; attempt: AttemptState; answer?: ReactNode }) {
  const execution = item.execution;
  if (!execution) return null;
  const { thread } = execution;
  const tail = tailView(attempt, item);
  const ci = attempt.ci[item.itemId];
  return (
    <section aria-label="Attempt" className="mt-4 space-y-3 border-t border-border pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Attempt</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Attempt</dt>
        <dd className="font-mono break-all">{execution.attemptId}</dd>
        <dt className="text-muted-foreground">T3 thread</dt>
        <dd className="font-mono break-all">
          {thread.environmentId} / {thread.projectId} / {thread.threadId}
          {thread.turnId ? ` · turn ${thread.turnId}` : ""}
        </dd>
        {tail.kind !== "waiting" && tail.frame && (
          <>
            <dt className="text-muted-foreground">Thread status</dt>
            <dd>{tail.frame.threadStatus}</dd>
          </>
        )}
      </dl>

      {answer}

      <TailBox item={item} attempt={attempt} />

      <CiPhases ci={ci} />
    </section>
  );
}

function TailBox({ item, attempt }: { item: ItemSnapshot; attempt: AttemptState }) {
  const tail = tailView(attempt, item);
  const frame = tail.kind === "waiting" ? null : tail.frame;
  const lines = tailLines(frame ?? undefined);
  const ref = useRef<HTMLPreElement>(null);
  const last = lines.at(-1);
  // Keep the newest line in view as frames replace each other.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, last, frame?.at]);
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Live tail</span>
        {tail.kind === "live" && <span className="text-emerald-700 dark:text-emerald-400">● live</span>}
      </div>
      {tail.kind === "unavailable" && (
        <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          Live detail unavailable: {tail.reason}
          {frame ? " Showing the last tail received." : ""}
        </p>
      )}
      {tail.kind === "waiting" && <p className="mt-1 text-xs text-muted-foreground">Waiting for live detail from the relay…</p>}
      {lines.length > 0 && (
        <pre
          ref={ref}
          aria-label="Live tail"
          className={cn(
            "mt-1 max-h-64 overflow-auto rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap break-all",
            tail.kind === "unavailable" && "opacity-60",
          )}
        >
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

function CiPhases({ ci }: { ci: CiMessage | undefined }) {
  return (
    <div className="text-xs">
      <div className="text-muted-foreground">CI</div>
      {!ci ? (
        <p className="mt-1 text-muted-foreground">No CI detail yet.</p>
      ) : !ci.available ? (
        <p className="mt-1 text-amber-700 dark:text-amber-300">CI detail unavailable: {ci.reason}</p>
      ) : (
        <>
          <p className="mt-1">
            {ci.summary} <span className="font-mono text-muted-foreground">{ci.sha.slice(0, 10)}</span>
          </p>
          {ci.phases.length === 0 ? (
            <p className="text-muted-foreground">No phases reported.</p>
          ) : (
            <ul aria-label="CI phases" className="mt-1 space-y-0.5">
              {ci.phases.map((phase, i) => {
                const href = safeHref(phase.url);
                return (
                  <li key={`${phase.name}-${i}`} data-status={phase.status} className="flex items-center gap-2">
                    <span aria-hidden className={cn("w-3 text-center", CI_TONE[phase.status])}>{CI_STATUS_MARK[phase.status] ?? "?"}</span>
                    {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{phase.name}</a> : <span>{phase.name}</span>}
                    <span className={cn("text-muted-foreground", CI_TONE[phase.status])}>{phase.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
