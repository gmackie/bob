import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createContext } from "@linear-clone/api";
import { type Database, forgeBuildArtifacts, forgeBuilds, issueGitLinks, issues } from "@linear-clone/db";
import { z } from "zod";

type BuildStatus = "queued" | "running" | "passed" | "failed" | "canceled" | "superseded";
type ForgeBuildRecord = typeof forgeBuilds.$inferSelect;

const buildStatusInputSchema = z.object({
  repoId: z.string().min(1),
  revId: z.string().min(1),
  stage: z.string().optional(),
  status: z.string().min(1),
  runId: z.string().optional(),
  imageTag: z.string().optional(),
  imageDigest: z.string().optional(),
  externalJobId: z.string().optional(),
  artifactManifestRef: z.string().optional(),
  issueIds: z.array(z.string().uuid()).optional(),
  issueIdentifiers: z.array(z.string().max(255)).optional(),
  commitIds: z.array(z.string().max(255)).optional(),
});

function normalizeBuildStatus(value: string): BuildStatus | null {
  const status = value.toLowerCase().trim();

  if (status === "running" || status === "in_progress") return "running";
  if (status === "queued" || status === "queue") return "queued";
  if (status === "passed" || status === "success" || status === "successful") return "passed";
  if (status === "failed" || status === "failure" || status === "error") return "failed";
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "superseded") return "superseded";

  return null;
}

function isTerminalBuildStatus(status: BuildStatus): boolean {
  return status === "passed" || status === "failed" || status === "canceled" || status === "superseded";
}

function getRequestToken(request: NextRequest) {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return authorizationHeader.slice("bearer ".length).trim();
  }
  return request.headers.get("x-api-key")?.trim();
}

function normalizeOptionalStringArray(values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  )];
}

function normalizeOptionalUuidArray(values: string[] | undefined): string[] {
  return normalizeOptionalStringArray(values).filter((value) => z.string().uuid().safeParse(value).success);
}

function normalizeOptionalValues(values: Array<string | undefined>): string[] {
  return normalizeOptionalStringArray(values.filter((value): value is string => typeof value === "string"));
}

export async function resolveIssueIdsForPayload(db: Database, payload: {
  issueIds?: string[];
  issueIdentifiers?: string[];
  commitIds?: string[];
  revId: string;
  imageTag?: string;
  imageDigest?: string;
}): Promise<string[]> {
  const issueIds = new Set<string>(normalizeOptionalUuidArray(payload.issueIds));

  const issueIdentifiers = normalizeOptionalStringArray(payload.issueIdentifiers);
  if (issueIdentifiers.length > 0) {
    const identifierRows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(inArray(issues.identifier, issueIdentifiers));

    for (const row of identifierRows) {
      issueIds.add(row.id);
    }
  }

  const commitRefs = normalizeOptionalStringArray([
    ...normalizeOptionalStringArray(payload.commitIds),
    payload.revId,
    ...normalizeOptionalValues([payload.imageTag, payload.imageDigest]),
  ]);

  if (commitRefs.length > 0) {
    const linkedRows = await db
      .select({ issueId: issueGitLinks.issueId })
      .from(issueGitLinks)
      .where(and(eq(issueGitLinks.type, "commit"), inArray(issueGitLinks.externalId, commitRefs)));

    for (const row of linkedRows) {
      issueIds.add(row.issueId);
    }
  }

  return [...issueIds];
}

async function ensureBuildTaskBinding(db: Database, buildId: string, issueIds: string[]) {
  if (issueIds.length !== 1) {
    return;
  }

  const [existing] = await db
    .select({ taskId: forgeBuilds.taskId })
    .from(forgeBuilds)
    .where(eq(forgeBuilds.id, buildId))
    .limit(1);

  if (!existing || existing.taskId) {
    return;
  }

  await db
    .update(forgeBuilds)
    .set({
      taskId: issueIds[0],
      updatedAt: new Date(),
    })
    .where(eq(forgeBuilds.id, buildId));
}

async function resolveBuild(ctxDb: Database, payload: {
  repoId: string;
  revId: string;
  stage?: string;
  runId?: string;
  imageDigest?: string;
  externalJobId?: string | null;
  artifactManifestRef?: string | null;
  imageTag?: string;
  status: BuildStatus;
  issueIds: string[];
}): Promise<ForgeBuildRecord | null> {
  const where = [
    eq(forgeBuilds.repoId, payload.repoId),
    eq(forgeBuilds.revId, payload.revId),
  ];
  if (payload.runId) {
    where.push(eq(forgeBuilds.runId, payload.runId));
  }

  const existing = await ctxDb
    .select()
    .from(forgeBuilds)
    .where(and(...where))
    .orderBy(desc(forgeBuilds.createdAt))
    .limit(1);

  const first = existing[0];
  if (first && !isTerminalBuildStatus(first.status)) {
    if (payload.issueIds.length > 0) {
      await ensureBuildTaskBinding(ctxDb, first.id, payload.issueIds);
    }
    return first;
  }

  if (!first || (isTerminalBuildStatus(first.status) && payload.status === "queued")) {
    const idempotencyKey = `legacy-build:${payload.repoId}:${payload.revId}:${payload.runId ?? payload.stage ?? "run"}`;
    const imageDigest = payload.imageTag ?? payload.imageDigest ?? null;
    const taskId = payload.issueIds.length === 1 ? payload.issueIds[0] : null;
    const [created] = await ctxDb
      .insert(forgeBuilds)
      .values({
        repoId: payload.repoId,
        revId: payload.revId,
        runId: payload.runId,
        taskId,
        status: payload.status,
        idempotencyKey,
        ciProvider: "legacy",
        externalJobId: payload.externalJobId ?? null,
        artifactManifestRef: payload.artifactManifestRef ?? null,
        imageDigest,
        startedAt: payload.status === "running" ? new Date() : undefined,
        completedAt: isTerminalBuildStatus(payload.status) ? new Date() : undefined,
      })
      .returning();

    return created ?? null;
  }

  if (payload.issueIds.length > 0) {
    await ensureBuildTaskBinding(ctxDb, first.id, payload.issueIds);
  }

  return first ?? null;
}

export async function POST(request: NextRequest) {
  const token = getRequestToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = buildStatusInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsedBody.error.flatten() }, { status: 400 });
  }

  const payload = parsedBody.data;
  const normalizedStatus = normalizeBuildStatus(payload.status);
  if (!normalizedStatus) {
    return NextResponse.json({ error: "Invalid status", status: payload.status }, { status: 400 });
  }

  const ctx = await createContext({
    req: {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  });

  if (!ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedIssueIds = await resolveIssueIdsForPayload(ctx.db, {
    issueIds: payload.issueIds,
    issueIdentifiers: payload.issueIdentifiers,
    commitIds: payload.commitIds,
    revId: payload.revId,
    imageTag: payload.imageTag,
    imageDigest: payload.imageDigest,
  });

  const build = await resolveBuild(ctx.db, {
    repoId: payload.repoId,
    revId: payload.revId,
    stage: payload.stage,
    runId: payload.runId,
    imageTag: payload.imageTag,
    imageDigest: payload.imageDigest,
    externalJobId: payload.externalJobId,
    artifactManifestRef: payload.artifactManifestRef,
    status: normalizedStatus,
    issueIds: resolvedIssueIds,
  });

  if (!build) {
    return NextResponse.json({ error: "Failed to resolve build" }, { status: 500 });
  }

  const shouldAttachArtifact = Boolean(payload.imageTag && payload.stage === "image");
  if (shouldAttachArtifact) {
    const imageTag = payload.imageTag;
    if (!imageTag) {
      return NextResponse.json({ error: "Missing image tag" }, { status: 400 });
    }

    const [existingArtifact] = await ctx.db
      .select({ id: forgeBuildArtifacts.id })
      .from(forgeBuildArtifacts)
      .where(
        and(
          eq(forgeBuildArtifacts.buildId, build.id),
          eq(forgeBuildArtifacts.storageKey, imageTag),
          eq(forgeBuildArtifacts.type, "container_image")
        )
      )
      .limit(1);

    if (!existingArtifact) {
      const artifactDigest = payload.imageDigest ?? imageTag;
      await ctx.db.insert(forgeBuildArtifacts).values({
        buildId: build.id,
        type: "container_image",
        storageKey: imageTag,
        digest: artifactDigest,
        metadata: {
          source: "legacy_forge_build_status",
          stage: payload.stage ?? null,
        },
      });
    }
  }

  const noChange =
    build.repoId === payload.repoId &&
    build.revId === payload.revId &&
    build.status === normalizedStatus &&
    build.imageDigest === (payload.imageTag ?? payload.imageDigest ?? null) &&
    build.externalJobId === (payload.externalJobId ?? null) &&
    build.artifactManifestRef === (payload.artifactManifestRef ?? null);

  if (noChange) {
    return NextResponse.json({ ok: true, idempotent: true, buildId: build.id, status: build.status });
  }

  const startedAt = build.startedAt ?? (normalizedStatus === "running" ? new Date() : null);
  const completedAt = isTerminalBuildStatus(normalizedStatus)
    ? new Date()
    : build.completedAt;

  const [updated] = await ctx.db
    .update(forgeBuilds)
    .set({
      status: normalizedStatus,
      imageDigest: payload.imageTag ?? payload.imageDigest ?? build.imageDigest,
      externalJobId: payload.externalJobId ?? build.externalJobId,
      artifactManifestRef: payload.artifactManifestRef ?? build.artifactManifestRef,
      runId: payload.runId ?? build.runId,
      startedAt: startedAt ?? undefined,
      completedAt,
      updatedAt: new Date(),
    })
    .where(eq(forgeBuilds.id, build.id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Failed to update build" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    idempotent: false,
    buildId: updated.id,
    status: updated.status,
  });
}

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "forge-build-status-legacy" });
}
