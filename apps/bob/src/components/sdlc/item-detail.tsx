import type { ReactNode } from "react";
import { MILESTONE_LABEL, MILESTONES, safeHref, STATE_PRESENTATION, type Row } from "@bob/sdlc-view";

import { cn } from "@gmacko/core/ui";

import { ReleaseSection } from "./release-section";
import { AttentionBadge } from "./state-badge";

/** `attempt` is the L5 attempt view; when given it shows the T3 thread, so the row here is left out. */
export function ItemDetail({ row, onClose, onOpenPlan, actions, attempt }: { row: Row; onClose: () => void; onOpenPlan: () => void; actions?: ReactNode; attempt?: ReactNode }) {
  const { item, issue, target, plan } = row;
  const thread = item.execution?.thread;
  const title = issue.identifier ?? issue.issueId;
  const issueHref = safeHref(issue.url);
  const presentation = STATE_PRESENTATION[item.state];
  return (
    <aside aria-label="Item detail" className="rounded-xl border border-border bg-card px-5 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">
            {issueHref ? (
              <a href={issueHref} target="_blank" rel="noreferrer" className="hover:underline">{title}</a>
            ) : title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.startupName} / {target.repository.repositoryId} · {target.environmentId}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close item detail"
          className="rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          ×
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">State</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <AttentionBadge state={item.state} attention={row.attention} />
          {presentation.hint && <span className="text-xs text-muted-foreground">{presentation.hint}</span>}
        </dd>

        <dt className="text-muted-foreground">Milestones</dt>
        <dd className="flex flex-wrap gap-1.5">
          {MILESTONES.map((m) => {
            const achieved = item.achievedMilestones.includes(m);
            return (
              <span
                key={m}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-xs",
                  achieved ? "border-emerald-500/40 bg-emerald-500/10 text-foreground" : "border-border text-muted-foreground/60",
                )}
              >
                {MILESTONE_LABEL[m]}
                <span className="sr-only">: {achieved ? "achieved" : "not yet"}</span>
              </span>
            );
          })}
        </dd>

        <dt className="text-muted-foreground">Attempt</dt>
        <dd className="font-mono text-xs">{item.currentAttemptId ?? <span className="font-sans text-muted-foreground">none yet</span>}</dd>

        {!attempt && (
          <>
            <dt className="text-muted-foreground">T3 thread</dt>
            <dd className="font-mono text-xs break-all">
              {thread ? (
                <>
                  {thread.environmentId} / {thread.projectId} / {thread.threadId}
                  {thread.turnId ? ` · turn ${thread.turnId}` : ""}
                </>
              ) : (
                <span className="font-sans text-muted-foreground">not started</span>
              )}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground">Completion</dt>
        <dd>{plan.definition.items.find((d) => d.itemId === item.itemId)?.completionTarget ?? "unknown"}</dd>

        <dt className="text-muted-foreground">Record</dt>
        <dd className="text-xs text-muted-foreground">
          v{item.resourceVersion} · {item.operationIds.length} operations · {item.evidenceRefs.length} evidence refs
        </dd>
      </dl>

      {item.release && <ReleaseSection release={item.release} />}

      <button
        type="button"
        onClick={onOpenPlan}
        className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        Open plan
      </button>

      {attempt}

      {actions}
    </aside>
  );
}
