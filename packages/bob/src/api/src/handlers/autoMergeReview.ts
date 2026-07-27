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

import { and, desc, eq, inArray } from "@bob/db";
import { db } from "@bob/db/client";
import { pullRequests, taskRuns } from "@bob/db/schema";
import { dispatchReviewSession } from "@bob/execution/runtime/taskExecutor";

import type { GitProvider } from "../services/git/providers/types";
import {
  createProviderClient,
  getConnection,
} from "../services/git/providerConnectionService";

// task_run statuses that mean a review session is still in flight for a PR — a
// verdict hasn't been posted yet, so we must not dispatch another reviewer.
const ACTIVE_REVIEW_STATUSES = [
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
}

export interface AutoMergeResult {
  scanned: number;
  reviewed: number;
  merged: number;
  skipped: number;
  items: {
    pr: string;
    action: "merged" | "reviewed" | "skipped";
    reason?: string;
  }[];
}

/** Is a review session already in flight for this PR? (suppresses re-dispatch) */
async function hasActiveReview(pullRequestId: string): Promise<boolean> {
  const existing = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.pullRequestId, pullRequestId),
      eq(taskRuns.runPhase, "review"),
      inArray(taskRuns.status, ACTIVE_REVIEW_STATUSES),
    ),
    columns: { id: true },
  });
  return !!existing;
}

export async function autoReviewAndMerge(
  cfg: AutoMergeConfig,
): Promise<AutoMergeResult> {
  const result: AutoMergeResult = {
    scanned: 0,
    reviewed: 0,
    merged: 0,
    skipped: 0,
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
  let reviewsSpent = 0;
  let mergesSpent = 0;

  const openPrs = await db.query.pullRequests.findMany({
    where: eq(pullRequests.status, "open"),
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
        result.skipped++;
        result.items.push({ pr: label, action: "skipped", reason: `remote ${remote.state}` });
        continue;
      }
      if (remote.draft) {
        result.skipped++;
        result.items.push({ pr: label, action: "skipped", reason: "draft" });
        continue;
      }

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
            headBranch: pr.headBranch ?? null,
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
        result.items.push({ pr: label, action: "reviewed", reason: "changes requested" });
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
        result.items.push({
          pr: label,
          action: "reviewed",
          reason: `approved, waiting CI (${ci.state}/${ci.total})`,
        });
        continue;
      }
      if (remote.mergeable === false) {
        result.items.push({ pr: label, action: "reviewed", reason: "approved, has conflict" });
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
      mergesSpent++;

      await client.mergePullRequest(
        pr.remoteOwner,
        pr.remoteName,
        pr.number,
        "squash",
      );
      await db
        .update(pullRequests)
        .set({ status: "merged", mergedAt: new Date().toISOString() })
        .where(eq(pullRequests.id, pr.id));
      result.merged++;
      result.items.push({ pr: label, action: "merged" });
    } catch (err) {
      result.skipped++;
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
