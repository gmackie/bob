// Autonomous PR reviewer + auto-merge reaper.
//
// Bob opens far more PRs than get merged by hand (hundreds sit in review). This
// driver reviews each open PR with Claude and merges the ones that clear the
// bar: CI green AND an approving AI review AND no merge conflict. It runs on a
// schedule (a Cloudflare Cron trigger on the bob worker), mirroring autoDrain.
//
// Design notes:
//  - The AI-review *verdict* lives on the PR itself (a Forgejo review submitted
//    at the head SHA), NOT in a bob table — so there's no migration and Forgejo
//    is the single source of truth for "already reviewed this commit".
//  - Only gitea/Forgejo providers are handled (that's where all of Bob's PRs
//    live); PRs on providers without review/status support are skipped.
//  - Reuses prService.mergePr, so DB status sync + branch cleanup are unchanged.

import { asc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { pullRequests } from "@bob/db/schema";

import type { GitProvider } from "../services/git/providers/types";
import {
  createProviderClient,
  getConnection,
} from "../services/git/providerConnectionService";

export interface AutoMergeConfig {
  /** Max open PRs to process per run (caps review spend + merge/deploy fan-out). */
  maxPerRun: number;
  /** Anthropic model for the review pass. */
  reviewModel: string;
  anthropicApiKey: string;
  /** When true, review and post verdicts but never actually merge. */
  dryRun?: boolean;
  /**
   * Shared Forgejo/gitea token used to act on PRs that have no per-user OAuth
   * connection. Bob's PRs are opened by the runner's embedded gmackie token,
   * not a stored connection, so without this fallback every PR is skipped.
   */
  forgejoToken?: string;
  /** Instance URL the forgejoToken is valid for (e.g. https://git.forgegraf.com). */
  forgejoInstanceUrl?: string;
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

const MAX_DIFF_CHARS = 60_000;

interface ReviewVerdict {
  decision: "approve" | "request_changes";
  summary: string;
}

async function reviewWithClaude(
  cfg: AutoMergeConfig,
  pr: { title: string; body: string | null; diff: string },
): Promise<ReviewVerdict> {
  const truncated = pr.diff.length > MAX_DIFF_CHARS;
  const diff = truncated ? pr.diff.slice(0, MAX_DIFF_CHARS) : pr.diff;

  const system =
    "You are a rigorous senior engineer reviewing a pull request opened by an " +
    "autonomous coding agent. Approve ONLY if the change is correct, safe, " +
    "self-consistent, and complete for its stated intent. Request changes if " +
    "you see bugs, security issues, broken/omitted logic, obvious test gaps, " +
    "or if the diff looks incomplete or off-topic. Be decisive; do not hedge. " +
    'Respond with ONLY a JSON object: {"decision":"approve"|"request_changes",' +
    '"summary":"<=6 sentences, concrete"}.';

  const user =
    `PR title: ${pr.title}\n\n` +
    `PR description:\n${pr.body ?? "(none)"}\n\n` +
    `Unified diff${truncated ? " (TRUNCATED — treat missing context as risk)" : ""}:\n` +
    "```diff\n" +
    diff +
    "\n```";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.reviewModel,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API error (${response.status}): ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text =
    data.content?.map((b) => (b.type === "text" ? b.text : "")).join("") ?? "";

  // Tolerate prose around the JSON; grab the first {...} block.
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) {
    // Unparseable → fail safe (never auto-approve on ambiguity).
    return {
      decision: "request_changes",
      summary: "Automated review could not be parsed; not approving.",
    };
  }
  const parsed = JSON.parse(match[0]) as Partial<ReviewVerdict>;
  return {
    decision: parsed.decision === "approve" ? "approve" : "request_changes",
    summary: parsed.summary?.slice(0, 2000) ?? "(no summary)",
  };
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

  const openPrs = await db.query.pullRequests.findMany({
    where: eq(pullRequests.status, "open"),
    orderBy: [asc(pullRequests.createdAt)],
    limit: cfg.maxPerRun,
  });
  result.scanned = openPrs.length;

  // Cache the authenticated bot login per (userId, provider, instanceUrl).
  const botLoginCache = new Map<string, string>();

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

      // Resolve the bot login (to recognize our own prior review).
      const cacheKey = `${pr.userId}:${pr.provider}:${pr.instanceUrl ?? ""}`;
      let botLogin = botLoginCache.get(cacheKey);
      if (botLogin === undefined) {
        botLogin = (await client.getAuthenticatedUser()).username;
        botLoginCache.set(cacheKey, botLogin);
      }

      const reviews = await client.listPullRequestReviews(
        pr.remoteOwner,
        pr.remoteName,
        pr.number,
      );
      const ownReviewAtHead = reviews.find(
        (r) =>
          r.userLogin === botLogin &&
          r.commitId === headSha &&
          (r.state === "APPROVED" || r.state === "REQUEST_CHANGES"),
      );

      // Review once per head SHA. If we've already reviewed this commit, reuse
      // that verdict; otherwise run a fresh review and post it.
      let approved: boolean;
      if (ownReviewAtHead) {
        approved = ownReviewAtHead.state === "APPROVED";
      } else {
        const diff = await client.getPullRequestDiff(
          pr.remoteOwner,
          pr.remoteName,
          pr.number,
        );
        const verdict = await reviewWithClaude(cfg, {
          title: remote.title,
          body: remote.body,
          diff,
        });
        approved = verdict.decision === "approve";
        await client.createPullRequestReview(
          pr.remoteOwner,
          pr.remoteName,
          pr.number,
          approved ? "APPROVE" : "REQUEST_CHANGES",
          `🤖 Bob auto-review: **${approved ? "approved" : "changes requested"}**\n\n${verdict.summary}`,
        );
        result.reviewed++;
      }

      if (!approved) {
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
