import { NextResponse } from "next/server";

import {
  createProviderClient,
  getConnection,
} from "@bob/api/services/git/providerConnectionService";
import { and, eq, isNotNull, ne } from "@bob/db";
import { db } from "@bob/db/client";
import { pullRequests, repositories } from "@bob/db/schema";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const openPRs = await db.query.pullRequests.findMany({
    where: and(
      ne(pullRequests.status, "merged"),
      ne(pullRequests.status, "closed"),
    ),
    with: {
      repository: true,
    },
  });

  const results: Array<{
    prId: string;
    status: "synced" | "skipped" | "error";
    error?: string;
  }> = [];

  for (const pr of openPRs) {
    try {
      if (!pr.repository?.gitProviderConnectionId) {
        results.push({ prId: pr.id, status: "skipped" });
        continue;
      }

      const connection = await getConnection(
        pr.userId,
        pr.provider as "github" | "gitlab" | "gitea",
        pr.instanceUrl,
      );

      if (!connection) {
        results.push({ prId: pr.id, status: "skipped" });
        continue;
      }

      const client = createProviderClient(
        pr.provider as "github" | "gitlab" | "gitea",
        connection.accessToken,
        pr.instanceUrl,
      );

      const remotePR = await client.getPullRequest(
        pr.remoteOwner,
        pr.remoteName,
        pr.number,
      );

      let status = pr.status;
      if (remotePR.state === "merged") {
        status = "merged";
      } else if (remotePR.state === "closed") {
        status = "closed";
      } else if (remotePR.draft) {
        status = "draft";
      } else {
        status = "open";
      }

      await db
        .update(pullRequests)
        .set({
          title: remotePR.title,
          body: remotePR.body,
          status,
          additions: remotePR.additions,
          deletions: remotePR.deletions,
          changedFiles: remotePR.changedFiles,
          mergedAt: remotePR.mergedAt,
          closedAt: remotePR.closedAt,
        })
        .where(eq(pullRequests.id, pr.id));

      results.push({ prId: pr.id, status: "synced" });
    } catch (error) {
      results.push({
        prId: pr.id,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const synced = results.filter((r) => r.status === "synced").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    processed: results.length,
    synced,
    skipped,
    errors,
    results,
  });
}
