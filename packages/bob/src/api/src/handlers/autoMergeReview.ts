// Autonomous PR reviewer + auto-merge reaper.
//
// Bob opens far more PRs than get merged by hand (hundreds sit in review). This
// driver gets each open PR reviewed BY A BOB RUNNER AGENT (a subscription-authed
// CLI on the runner — NOT a metered model API) and merges the ones that clear
// the bar: CI green AND an approving review AND no merge conflict. It runs on a
// schedule (a Cloudflare Cron trigger on the bob worker), mirroring autoDrain.
//
// Design notes:
//  - Review is done by dispatching a runner session (dispatchReviewSession) the
//    same way every other Bob task runs. The agent posts its verdict as a native
//    git-host review bound to the head SHA. There is NO api.anthropic.com call.
//  - The verdict lives on the PR itself (a Forgejo review at the head SHA), NOT
//    in a bob table — so Forgejo is the single source of truth for "already
//    reviewed this commit", and the merge gate reads it directly.
//  - Review is async: one pass dispatches the review session, a later pass sees
//    the posted verdict and merges. An in-flight review (an active review
//    taskRun for the PR) suppresses re-dispatch so we don't spawn duplicates.
//  - Only gitea/Forgejo providers are handled (that's where all of Bob's PRs
//    live); PRs on providers without review/status support are skipped.
//  - Auto-repair closes the loop: a reviewed PR that can't merge (CI failing,
//    merge conflict, or reviewer requested changes) gets a runner agent
//    (dispatchRepairSession) dispatched to fix its branch and push back, so CI
//    re-runs and the PR converges to a merge instead of sitting reviewed-but-
//    stuck forever. Gated (repairEnabled) with per-PR + per-run guards.

import { and, desc, eq, inArray, notLike } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, pullRequests, taskRuns, workItems } from "@bob/db/schema";
import {
  
  dispatchRepairSession,
  dispatchReviewSession
} from "@bob/execution/runtime/taskExecutor";
import type {RepairReason} from "@bob/execution/runtime/taskExecutor";

import type { GitProvider } from "../services/git/providers/types";
import {
  createProviderClient,
  getConnection,
} from "../services/git/providerConnectionService";
import { mirrorWorkItemEvent } from "../services/tracker/trackerMirror.js";

// task_run statuses that mean a session is still in flight for a PR — for a
// review, the verdict hasn't posted yet; for a repair, the fix hasn't landed —
// so we must not dispatch another one of the same phase.
const ACTIVE_RUN_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  "blocked",
  "stopping",
  "host_unknown",
];

export interface AutoMergeConfig {
  /**
   * Legacy knob. Used as the default for both {@link maxReviewsPerRun} and
   * {@link maxMergesPerRun} when those aren't set individually. It no longer
   * caps how many PRs are *scanned* — see {@link scanLimit}.
   */
  maxPerRun: number;
  /**
   * How many open PRs to scan per run, newest-first. Scanning is cheap (a few
   * Forgejo GETs per PR) and — critically — newest-first so freshly opened PRs
   * are never starved behind a logjam of old, permanently-unmergeable PRs at
   * the front of an oldest-first queue. Defaults to {@link maxPerRun} * 12.
   */
  scanLimit?: number;
  /**
   * Max *fresh* Claude reviews per run (the real spend cap). PRs already
   * reviewed at their current head SHA don't consume this — they only get a
   * cheap merge-eligibility re-check. Defaults to {@link maxPerRun}.
   */
  maxReviewsPerRun?: number;
  /** Max merges (→ deploys) per run. Defaults to {@link maxPerRun}. */
  maxMergesPerRun?: number;
  /**
   * Runner agent used for the review session. Defaults to "codex" — claude
   * currently hangs on the runner's stdio permission prompt, so it can't review
   * unattended.
   */
  reviewAgentType?: string;
  /** When true, dispatch reviews but never actually merge. */
  dryRun?: boolean;
  /**
   * Shared Forgejo/gitea token used to act on PRs that have no per-user OAuth
   * connection. Bob's PRs are opened by the runner's embedded gmackie token,
   * not a stored connection, so without this fallback every PR is skipped.
   */
  forgejoToken?: string;
  /** Instance URL the forgejoToken is valid for (e.g. https://git.forgegraf.com). */
  forgejoInstanceUrl?: string;
  /**
   * Token of the dedicated reviewer bot — a DIFFERENT identity than the PR
   * author, so the git host accepts the review (it rejects self-reviews). The
   * agent posts its verdict with this. Without it the review can't be recorded.
   */
  reviewForgejoToken?: string;
  /**
   * Login of the reviewer bot — the merge gate only trusts a verdict authored by
   * this identity at the head SHA. Defaults to "bob-reviewer".
   */
  reviewerLogin?: string;
  /**
   * Close the loop: when a reviewed PR is stuck (CI failing, merge conflict, or
   * the reviewer requested changes), dispatch a runner agent to fix the PR branch
   * so it can converge to a merge. Off unless explicitly enabled — repair pushes
   * commits to PR branches (a real mutation), unlike review which only reads.
   */
  repairEnabled?: boolean;
  /** Runner agent used for the repair session. Defaults to "codex". */
  repairAgentType?: string;
  /** Max fresh repair dispatches per run (heavier than review — keep small). Defaults to 3. */
  maxRepairsPerRun?: number;
  /**
   * Cap on total repair attempts per PR across head SHAs. A repair that pushes a
   * fix changes the head SHA (a new attempt is allowed); this bounds a PR that
   * keeps failing so it can't loop forever. Defaults to 3.
   */
  maxRepairAttemptsPerPr?: number;
}

export interface AutoMergeResult {
  scanned: number;
  reviewed: number;
  repaired: number;
  merged: number;
  skipped: number;
  /**
   * How many PRs failed with a git-host AUTH error (401/403 / revoked token)
   * this run. These also land in `skipped`, but are counted separately because
   * a token-wide auth failure is a silent-dead-loop signal, not per-PR noise:
   * when it dominates, the whole review→repair→merge pipeline is down even
   * though the cron keeps firing and the counters look "healthy" (all skipped).
   * The worker escalates on this — see the `auto-merge-auth-failure` alert.
   */
  authFailures: number;
  items: {
    pr: string;
    action: "merged" | "reviewed" | "repaired" | "skipped";
    reason?: string;
  }[];
}

/**
 * Does this error look like a git-host authentication/authorization failure
 * (revoked/expired token, bad credentials) rather than a per-PR problem? Used
 * to distinguish a fleet-wide dead token from ordinary skips. Matches the shape
 * Forgejo/Gitea returns for a dead token: `Gitea API error (401): {"message":
 * "access token does not exist [...]"}`, plus generic 401/403/credential text.
 */
export function isAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("(401)") ||
    msg.includes("(403)") ||
    msg.includes("status 401") ||
    msg.includes("status 403") ||
    msg.includes("access token does not exist") ||
    msg.includes("unauthorized") ||
    msg.includes("credentials are incorrect") ||
    msg.includes("token does not exist")
  );
}

// Session statuses that mean an agent is (or may still be) working.
const LIVE_SESSION_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  "blocked",
  "stopping",
  "host_unknown",
];

/**
 * Is a review session already in flight for this PR? (suppresses re-dispatch)
 *
 * Keyed on the run's SESSION being live, not on task_runs.status alone: a
 * session that was reaped, errored during startup, or was released by hand
 * never closes its task_run, and 41 such zombie runs (some from July) had
 * every open PR reporting "review in flight" forever on 2026-08-21. The
 * zombie run is closed here so the counters stop lying too.
 */
async function hasActiveReview(pullRequestId: string): Promise<boolean> {
  return hasLiveRun(pullRequestId, "review");
}

async function hasLiveRun(pullRequestId: string, phase: "review" | "repair"): Promise<boolean> {
  const rows = await db
    .select({
      runId: taskRuns.id,
      runStatus: taskRuns.status,
      sessionStatus: chatConversations.status,
    })
    .from(taskRuns)
    .leftJoin(chatConversations, eq(chatConversations.id, taskRuns.sessionId))
    .where(
      and(
        eq(taskRuns.pullRequestId, pullRequestId),
        eq(taskRuns.runPhase, phase),
        inArray(taskRuns.status, ACTIVE_RUN_STATUSES),
      ),
    );
  let live = false;
  for (const r of rows) {
    if (r.sessionStatus && LIVE_SESSION_STATUSES.includes(r.sessionStatus)) {
      live = true;
      continue;
    }
    // Zombie: run says active, session is terminal (or gone). Close it.
    await db
      .update(taskRuns)
      .set({
        status: "failed",
        completedAt: new Date().toISOString(),
        blockedReason: `closed by auto-merge: session ${r.sessionStatus ?? "missing"} while run was ${r.runStatus}`,
      })
      .where(eq(taskRuns.id, r.runId))
      .catch(() => undefined);
  }
  return live;
}

interface RepairState {
  /** A repair session is currently in flight for this PR. */
  active: boolean;
  /** A repair has already been dispatched for this exact head SHA. */
  doneAtHead: boolean;
  /** Total repair attempts for this PR (across all head SHAs). */
  attempts: number;
}

/**
 * Repair dispatch state for a PR. One query drives all three loop guards:
 *  - `active`     → don't run two repairs at once,
 *  - `doneAtHead` → don't re-repair a head SHA a prior repair couldn't fix
 *                   (a successful repair changes the SHA, so this clears itself),
 *  - `attempts`   → cap total tries so a persistently-broken PR can't loop.
 * The head SHA is encoded in the repair run's identifier as `@<sha8>`.
 */
async function getRepairState(
  pullRequestId: string,
  headSha: string,
): Promise<RepairState> {
  const runs = await db.query.taskRuns.findMany({
    where: and(
      eq(taskRuns.pullRequestId, pullRequestId),
      eq(taskRuns.runPhase, "repair"),
    ),
    columns: { status: true, planningItemIdentifier: true },
  });
  const head8 = headSha.slice(0, 8);
  return {
    active: await hasLiveRun(pullRequestId, "repair"),
    doneAtHead: runs.some((r) =>
      r.planningItemIdentifier.endsWith(`@${head8}`),
    ),
    attempts: runs.length,
  };
}

export async function autoReviewAndMerge(
  cfg: AutoMergeConfig,
): Promise<AutoMergeResult> {
  const result: AutoMergeResult = {
    scanned: 0,
    reviewed: 0,
    repaired: 0,
    merged: 0,
    skipped: 0,
    authFailures: 0,
    items: [],
  };

  // Newest-first, and scan well beyond the review/merge budgets. Oldest-first
  // with a small cap starved every recent PR: the front of the queue fills with
  // old PRs that are already reviewed but can never merge (CI-red / conflict /
  // changes-requested), so each run re-touched the same stuck head and never
  // reached anything new. Newest-first means freshly opened PRs are reviewed
  // first; the two budgets below (not this limit) cap actual spend.
  const scanLimit = cfg.scanLimit ?? cfg.maxPerRun * 12;
  const reviewBudget = cfg.maxReviewsPerRun ?? cfg.maxPerRun;
  const mergeBudget = cfg.maxMergesPerRun ?? cfg.maxPerRun;
  const repairBudget = cfg.maxRepairsPerRun ?? 3;
  const repairAttemptCap = cfg.maxRepairAttemptsPerPr ?? 3;
  let reviewsSpent = 0;
  let mergesSpent = 0;
  let repairsSpent = 0;

  // Exclude Bob's own internal work branches. Repair/review sessions run on
  // throwaway `bob/repair/*` / `bob/review/*` branches; when a repair agent's
  // session branch gets auto-turned into a PR by the runner, it's an (often
  // empty) artifact — not a feature PR. Left in the scan they clog the
  // newest-first window and fail to merge, starving real PRs. Skip them here.
  const openPrs = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.status, "open"),
      notLike(pullRequests.headBranch, "bob/repair/%"),
      notLike(pullRequests.headBranch, "bob/review/%"),
    ),
    orderBy: [desc(pullRequests.createdAt)],
    limit: scanLimit,
  });
  result.scanned = openPrs.length;

  const reviewerLogin = cfg.reviewerLogin ?? "bob-reviewer";

  for (const pr of openPrs) {
    const label = `${pr.remoteOwner}/${pr.remoteName}#${pr.number}`;
    try {
      const connection = await getConnection(
        pr.userId,
        pr.provider as GitProvider,
        pr.instanceUrl,
      );
      let accessToken: string | undefined = connection?.accessToken;
      if (
        !accessToken &&
        pr.provider === "gitea" &&
        cfg.forgejoToken &&
        pr.instanceUrl === cfg.forgejoInstanceUrl
      ) {
        accessToken = cfg.forgejoToken;
      }
      if (!accessToken) {
        result.skipped++;
        result.items.push({ pr: label, action: "skipped", reason: "no connection" });
        continue;
      }

      const client = createProviderClient(
        pr.provider as GitProvider,
        accessToken,
        pr.instanceUrl,
      );

      // Only gitea/Forgejo has the review+status methods wired.
      if (
        !client.getCommitStatus ||
        !client.getPullRequestDiff ||
        !client.listPullRequestReviews ||
        !client.createPullRequestReview
      ) {
        result.skipped++;
        result.items.push({
          pr: label,
          action: "skipped",
          reason: `unsupported provider ${pr.provider}`,
        });
        continue;
      }

      const remote = await client.getPullRequest(
        pr.remoteOwner,
        pr.remoteName,
        pr.number,
      );

      // Reconcile: if it's no longer open remotely, fix bob's row and move on.
      if (remote.state !== "open") {
        await db
          .update(pullRequests)
          .set({
            status: remote.state,
            mergedAt: remote.mergedAt?.toISOString() ?? null,
            closedAt: remote.closedAt?.toISOString() ?? null,
          })
          .where(eq(pullRequests.id, pr.id));
        // Settle the work item too: merged → done, closed → back to the
        // human gate. Without this the item sat in in_review forever and the
        // tracker card was never closed (372 stranded items by 2026-08-20).
        await settleWorkItemForPr(
          pr,
          remote.state === "merged" ? "merged" : "pr_closed",
        );
        result.skipped++;
        result.items.push({ pr: label, action: "skipped", reason: `remote ${remote.state}` });
        continue;
      }
      if (remote.draft) {
        result.skipped++;
        result.items.push({ pr: label, action: "skipped", reason: "draft" });
        continue;
      }

      // First time we see this PR open: tell the tracker (card → In Review,
      // comment with the PR link). Idempotent via a marker on the work item.
      await announcePrOpenedOnce(pr);

      const headSha = remote.headSha;
      if (!headSha) {
        result.skipped++;
        result.items.push({ pr: label, action: "skipped", reason: "no head sha" });
        continue;
      }

      // The verdict we trust is a review authored by the reviewer bot (a
      // separate identity from the PR author) bound to the current head SHA.
      const reviews = await client.listPullRequestReviews(
        pr.remoteOwner,
        pr.remoteName,
        pr.number,
      );
      const ownReviewAtHead = reviews.find(
        (r) =>
          r.userLogin === reviewerLogin &&
          r.commitId === headSha &&
          (r.state === "APPROVED" || r.state === "REQUEST_CHANGES"),
      );

      // Close the loop: a PR blocked from merging (CI failing / conflict /
      // changes requested) gets a runner agent dispatched to FIX its branch, so
      // the pipeline converges instead of piling up un-mergeable reviewed PRs.
      // Records exactly one result item and is a no-op (just notes the blocked
      // state) when repair is disabled or not possible. Guards: one repair in
      // flight at a time, one attempt per head SHA, a per-PR attempt cap, and a
      // per-run budget.
      const tryRepair = async (
        reason: RepairReason,
        blockedNote: string,
      ): Promise<void> => {
        const repositoryId = pr.repositoryId;
        const headBranch = pr.headBranch;
        if (!cfg.repairEnabled || !repositoryId || !headBranch) {
          result.items.push({ pr: label, action: "reviewed", reason: blockedNote });
          return;
        }
        const rs = await getRepairState(pr.id, headSha);
        if (rs.active) {
          result.items.push({ pr: label, action: "reviewed", reason: "repair in flight" });
          return;
        }
        if (rs.doneAtHead) {
          result.items.push({
            pr: label,
            action: "reviewed",
            reason: `${blockedNote} (repair made no fix at this head)`,
          });
          return;
        }
        if (rs.attempts >= repairAttemptCap) {
          result.items.push({
            pr: label,
            action: "reviewed",
            reason: `${blockedNote} (repair cap ${repairAttemptCap} reached)`,
          });
          return;
        }
        if (repairsSpent >= repairBudget) {
          result.items.push({
            pr: label,
            action: "skipped",
            reason: "repair budget exhausted (deferred)",
          });
          return;
        }
        const dispatched = await dispatchRepairSession(
          pr.userId,
          {
            pullRequestId: pr.id,
            repositoryId,
            remoteOwner: pr.remoteOwner,
            remoteName: pr.remoteName,
            number: pr.number,
            instanceUrl: pr.instanceUrl,
            headSha,
            headBranch,
            title: remote.title,
            body: remote.body,
            reason,
          },
          cfg.repairAgentType ?? "codex",
        );
        if (!dispatched) {
          result.skipped++;
          result.items.push({
            pr: label,
            action: "skipped",
            reason: "repo has no runner checkout/workspace for repair",
          });
          return;
        }
        repairsSpent++;
        result.repaired++;
        result.items.push({
          pr: label,
          action: "repaired",
          reason: `repair dispatched (${reason})`,
        });
      };

      // Review once per head SHA. If a verdict already exists at this commit,
      // use it for the merge gate below. Otherwise the review is done by a Bob
      // runner agent — dispatch a review session (once) and move on; the verdict
      // (a git-host review at the head SHA) appears on a later pass.
      if (!ownReviewAtHead) {
        if (await hasActiveReview(pr.id)) {
          result.items.push({
            pr: label,
            action: "reviewed",
            reason: "review in flight",
          });
          continue;
        }
        // Dispatching a review is the rate-limited step — gate it on the review
        // budget. Deferring keeps this PR at the front of next run's newest-first
        // scan, so nothing is dropped, just paced.
        if (reviewsSpent >= reviewBudget) {
          result.items.push({
            pr: label,
            action: "skipped",
            reason: "review budget exhausted (deferred)",
          });
          continue;
        }
        if (!pr.repositoryId) {
          result.skipped++;
          result.items.push({
            pr: label,
            action: "skipped",
            reason: "no repository linked — cannot dispatch review",
          });
          continue;
        }
        if (!cfg.reviewForgejoToken) {
          // No separate reviewer identity → the agent can't post a verdict the
          // git host will accept. Don't spawn a no-op review session.
          result.skipped++;
          result.items.push({
            pr: label,
            action: "skipped",
            reason: "no reviewer token configured",
          });
          continue;
        }
        const dispatched = await dispatchReviewSession(
          pr.userId,
          {
            pullRequestId: pr.id,
            repositoryId: pr.repositoryId,
            remoteOwner: pr.remoteOwner,
            remoteName: pr.remoteName,
            number: pr.number,
            instanceUrl: pr.instanceUrl,
            headSha,
            headBranch: pr.headBranch,
            title: remote.title,
            body: remote.body,
            reviewToken: cfg.reviewForgejoToken,
          },
          cfg.reviewAgentType ?? "codex",
        );
        if (!dispatched) {
          result.skipped++;
          result.items.push({
            pr: label,
            action: "skipped",
            reason: "repo has no runner checkout/workspace for review",
          });
          continue;
        }
        reviewsSpent++;
        result.reviewed++;
        result.items.push({
          pr: label,
          action: "reviewed",
          reason: "review dispatched to runner",
        });
        continue;
      }

      if (ownReviewAtHead.state !== "APPROVED") {
        await tryRepair("changes-requested", "changes requested");
        continue;
      }

      // Approved — gate the merge on CI + mergeability.
      const ci = await client.getCommitStatus(
        pr.remoteOwner,
        pr.remoteName,
        headSha,
      );
      const ciGreen = ci.state === "success" && ci.total > 0;
      if (!ciGreen) {
        // A genuine CI failure is repairable; "pending"/absent means CI is still
        // running (or not wired) — wait, don't dispatch a repair against it.
        if (ci.state === "failure" || ci.state === "error") {
          await tryRepair("ci-failure", `approved, CI ${ci.state} (${ci.total})`);
        } else {
          result.items.push({
            pr: label,
            action: "reviewed",
            reason: `approved, waiting CI (${ci.state}/${ci.total})`,
          });
        }
        continue;
      }
      if (remote.mergeable === false) {
        await tryRepair("conflict", "approved, has conflict");
        continue;
      }

      if (cfg.dryRun) {
        result.items.push({ pr: label, action: "reviewed", reason: "approved, dryRun" });
        continue;
      }

      if (mergesSpent >= mergeBudget) {
        result.items.push({
          pr: label,
          action: "reviewed",
          reason: "approved+green, merge budget exhausted (deferred)",
        });
        continue;
      }
      await client.mergePullRequest(
        pr.remoteOwner,
        pr.remoteName,
        pr.number,
        "squash",
      );
      // Only count a merge that actually happened. A failed merge (e.g. a git
      // host 500) throws above and is caught below WITHOUT consuming budget —
      // otherwise a handful of un-mergeable PRs at the front exhaust the merge
      // budget every run and starve the good approved+green PRs behind them.
      mergesSpent++;
      await db
        .update(pullRequests)
        .set({ status: "merged", mergedAt: new Date().toISOString() })
        .where(eq(pullRequests.id, pr.id));
      await settleWorkItemForPr(pr, "merged");
      result.merged++;
      result.items.push({ pr: label, action: "merged" });
    } catch (err) {
      result.skipped++;
      if (isAuthError(err)) result.authFailures++;
      result.items.push({
        pr: label,
        action: "skipped",
        reason: `error: ${(err as Error).message}`.slice(0, 200),
      });
      console.error(`[auto-merge] ${label} failed:`, err);
    }
  }

  return result;
}


// ---------------------------------------------------------------------------
// Work-item settlement + tracker mirroring
// ---------------------------------------------------------------------------

type PrRow = typeof pullRequests.$inferSelect;

/** Resolve the work item a PR was produced for (via its session). */
async function workItemIdForPr(pr: PrRow): Promise<string | null> {
  if (!pr.sessionId) return null;
  const session = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, pr.sessionId),
    columns: { workItemId: true },
  });
  return session?.workItemId ?? null;
}

/**
 * Merged → work item done + tracker Done; closed-unmerged → work item back to
 * backlog (human gate) + tracker Backlog. Best-effort, never throws.
 */
export async function settleWorkItemForPr(
  pr: PrRow,
  outcome: "merged" | "pr_closed",
): Promise<void> {
  try {
    const workItemId = await workItemIdForPr(pr);
    if (!workItemId) return;
    const r = await mirrorWorkItemEvent(db, workItemId, { kind: outcome, prUrl: pr.url });
    console.log(
      `[auto-merge] settled work item ${workItemId.slice(0, 8)} ${outcome} → ${r.bobStatus ?? "(unchanged)"} mirrored=${r.mirrored}${r.reason ? ` (${r.reason})` : ""}`,
    );
  } catch (err) {
    console.error(`[auto-merge] settle failed for ${pr.url}:`, err);
  }
}

async function announcePrOpenedOnce(pr: PrRow): Promise<void> {
  try {
    const workItemId = await workItemIdForPr(pr);
    if (!workItemId) return;
    const item = await db.query.workItems.findFirst({
      where: eq(workItems.id, workItemId),
      columns: { sourceMetadata: true },
    });
    const meta = item?.sourceMetadata ?? {};
    const announced = Array.isArray(meta.announcedPrs) ? (meta.announcedPrs as string[]) : [];
    if (announced.includes(pr.url)) return;
    // Mark first so a tracker hiccup can't cause a comment storm.
    await db
      .update(workItems)
      .set({ sourceMetadata: { ...meta, announcedPrs: [...announced, pr.url] } })
      .where(eq(workItems.id, workItemId));
    await mirrorWorkItemEvent(db, workItemId, { kind: "pr_opened", prUrl: pr.url });
  } catch (err) {
    console.error(`[auto-merge] pr_opened announce failed for ${pr.url}:`, err);
  }
}
