#!/usr/bin/env tsx
/**
 * One-time migration script: copies all local work items to ForgeGraph.
 *
 * Usage:
 *   FG_API_URL=https://forge.gmac.io FG_API_TOKEN=<token> \
 *     pnpm -F @bob/api exec tsx src/scripts/migrate-work-items-to-forgegraph.ts
 *
 * Idempotent: uses externalId so re-runs are safe.
 */

import { db } from "@bob/db/client";
import {
  activities,
  projects,
  workItemArtifacts,
  workItemDependencies,
  workItems,
} from "@bob/db/schema";
import { eq } from "@bob/db";

import { ForgeGraphClient } from "../services/forgegraph/forgeGraphClient";

const FG_API_URL = process.env.FG_API_URL ?? "https://forge.gmac.io";
const FG_API_TOKEN = process.env.FG_API_TOKEN;

if (!FG_API_TOKEN) {
  console.error("FG_API_TOKEN is required");
  process.exit(1);
}

const fg = new ForgeGraphClient({
  baseUrl: FG_API_URL,
  apiToken: FG_API_TOKEN,
  timeoutMs: 30000,
});

async function main() {
  console.log(`Migrating work items to ForgeGraph at ${FG_API_URL}`);

  // 1. Load all work items and projects
  const allItems = await db.query.workItems.findMany({
    orderBy: (wi, { asc }) => [asc(wi.createdAt)],
  });
  const allProjects = await db.query.projects.findMany();
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));

  console.log(`Found ${allItems.length} work items, ${allProjects.length} projects`);

  // 2. Create work items in ForgeGraph
  // Map Bob kanban statuses to ForgeGraph delivery statuses
  const statusMap: Record<string, string> = {
    draft: "draft",
    backlog: "draft",
    todo: "draft",
    planned: "draft",
    in_progress: "approved",
    in_review: "ready_for_review",
    done: "released",
    cancelled: "released",
  };

  const bobToFgId = new Map<string, string>();
  let created = 0;
  let skipped = 0;

  for (const item of allItems) {
    const project = item.projectId ? projectMap.get(item.projectId) : null;
    const fgStatus = statusMap[item.status] ?? "draft";

    try {
      const fgItem = await fg.createWorkItem({
        kind: item.kind as "issue" | "epic" | "task",
        title: item.title,
        description: item.description ?? undefined,
        status: fgStatus,
        repositoryId: item.projectId ?? undefined,
        externalId: item.id,
        metadata: {
          projectKey: project?.key ?? null,
          sequenceNumber: item.sequenceNumber,
          bobStatus: item.status,
          migratedAt: new Date().toISOString(),
        },
      });

      bobToFgId.set(item.id, fgItem.id);
      created++;

      if (created % 10 === 0) {
        console.log(`  Created ${created}/${allItems.length} work items...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If it already exists (idempotent), try to look it up
      if (msg.includes("409") || msg.includes("already exists")) {
        const existing = await fg.getWorkItemByExternalId(item.id);
        if (existing) {
          bobToFgId.set(item.id, existing.id);
          skipped++;
          continue;
        }
      }
      console.error(`  Failed to migrate work item ${item.id}: ${msg}`);
    }
  }

  console.log(`Work items: ${created} created, ${skipped} already existed`);

  // 3. Migrate dependencies
  const allDeps = await db.query.workItemDependencies.findMany();
  let depsCreated = 0;

  for (const dep of allDeps) {
    const fromFgId = bobToFgId.get(dep.workItemId);
    const toFgId = bobToFgId.get(dep.dependsOnWorkItemId);

    if (!fromFgId || !toFgId) {
      console.warn(`  Skipping dependency ${dep.id}: missing FG ID mapping`);
      continue;
    }

    try {
      await fg.addDependency(fromFgId, toFgId);
      depsCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("409") && !msg.includes("already exists")) {
        console.error(`  Failed to migrate dependency ${dep.id}: ${msg}`);
      }
    }
  }

  console.log(`Dependencies: ${depsCreated} created`);

  // 4. Migrate artifacts
  const allArtifacts = await db.query.workItemArtifacts.findMany({
    orderBy: (a, { asc }) => [asc(a.createdAt)],
  });
  let artifactsCreated = 0;

  for (const artifact of allArtifacts) {
    const fgId = bobToFgId.get(artifact.workItemId);
    if (!fgId) continue;

    try {
      await fg.createArtifact(fgId, {
        producerType: (artifact.producerType as any) ?? "bob",
        producerId: artifact.taskRunId ?? undefined,
        artifactType: artifact.artifactType,
        artifactRole: artifact.artifactRole,
        title: artifact.title ?? undefined,
        summary: artifact.summary ?? undefined,
        content: artifact.content ?? undefined,
        url: artifact.url ?? undefined,
        metadata: {
          originalId: artifact.id,
          migratedAt: new Date().toISOString(),
        },
      });
      artifactsCreated++;
    } catch (err) {
      // Skip duplicates silently
    }
  }

  console.log(`Artifacts: ${artifactsCreated} created`);

  // 5. Migrate activities
  const allActivities = await db.query.activities.findMany({
    orderBy: (a, { asc }) => [asc(a.createdAt)],
  });
  let activitiesCreated = 0;

  for (const activity of allActivities) {
    if (!activity.workItemId) continue;
    const fgId = bobToFgId.get(activity.workItemId);
    if (!fgId) continue;

    try {
      await fg.recordActivity(fgId, {
        actorId: activity.userId ?? "bob",
        type: activity.type,
        metadata: {
          originalId: activity.id,
          fromValue: activity.fromValue,
          toValue: activity.toValue,
          migratedAt: new Date().toISOString(),
        },
      });
      activitiesCreated++;
    } catch (err) {
      // Skip duplicates silently
    }
  }

  console.log(`Activities: ${activitiesCreated} created`);

  // Summary
  console.log("\n=== Migration Complete ===");
  console.log(`Work Items:    ${created} created, ${skipped} pre-existing`);
  console.log(`Dependencies:  ${depsCreated} created`);
  console.log(`Artifacts:     ${artifactsCreated} created`);
  console.log(`Activities:    ${activitiesCreated} created`);
  console.log(`\nSet FG_API_TOKEN in your .env and rebuild to activate ForgeGraph paths.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
