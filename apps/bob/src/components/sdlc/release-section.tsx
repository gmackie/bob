import type { ReactNode } from "react";
import { RELEASE_STAGE_PRESENTATION, safeHref, type ReleaseStatus } from "@bob/sdlc-view";

import { cn } from "@gmacko/core/ui";

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 8) : null);

/** Stages whose note is a problem, not a remark. */
const ALARM = new Set<ReleaseStatus["stage"]>(["blocked", "checks-failed"]);

/**
 * The item's release (BOB-82): stage, PR, branch, head, approved/merged commits, deployment
 * and the coordinator's note. Actions for it come from itemCommands via the actions panel.
 */
export function ReleaseSection({ release }: { release: ReleaseStatus }) {
  const stage = RELEASE_STAGE_PRESENTATION[release.stage];
  const alarm = ALARM.has(release.stage);
  const pr = release.pullRequest;
  const prHref = safeHref(pr?.url);
  const tone = stage.attention === "failed"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : stage.attention === "needs_human"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-border text-muted-foreground";
  const sha = (value: string | null | undefined) => (value ? <span className="font-mono text-xs" title={value}>{short(value)}</span> : null);
  const rows: Array<[string, ReactNode]> = [
    ["Pull request", pr ? (prHref ? <a href={prHref} target="_blank" rel="noreferrer" className="hover:underline">#{pr.number}</a> : `#${pr.number}`) : null],
    ["Branch", release.branch ? <span className="font-mono text-xs break-all">{release.branch}</span> : null],
    ["Head", sha(release.headSha)],
    ["Approved", sha(release.approvedSha)],
    ["Merged", sha(release.mergeSha)],
    ["Deployment", release.appSlug || release.deploymentId
      ? <span className="font-mono text-xs break-all">{[release.appSlug, release.deploymentId].filter(Boolean).join(" · ")}</span>
      : null],
    ["Auto-merge", release.autoMerge ? "on" : "off"],
  ];
  return (
    <section aria-label="Release" className="mt-4 border-t border-border pt-3">
      <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Release
        <span data-release-stage={release.stage} className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal", tone)}>
          {stage.label}
        </span>
        <span className="font-normal normal-case tracking-normal">{stage.hint}</span>
      </h3>
      {release.note && (
        <p
          role={alarm ? "alert" : undefined}
          className={cn(
            "mt-2 rounded-md border px-2 py-1.5 text-xs",
            alarm ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border text-muted-foreground",
          )}
        >
          {release.note}
        </p>
      )}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.filter(([, value]) => value !== null).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
