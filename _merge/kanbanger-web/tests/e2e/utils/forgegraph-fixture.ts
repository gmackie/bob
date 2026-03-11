import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  createDb,
  forgeBuildArtifacts,
  forgeBuilds,
  forgeRepositories,
  projects,
  forgeRevisions,
  forgeRunOverlays,
  users,
  workspaces,
  workspaceMembers,
} from "@linear-clone/db";

export type ForgeGraphFixture = {
  workspaceId: string;
  workspaceSlug: string;
  projectIds: string[];
  repositoryId: string;
  revisionId: string;
  runId: string;
  buildIds: string[];
};

const BETA_TEST_USER_ID = process.env.BETA_TEST_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const BETA_TEST_USER_EMAIL =
  process.env.BETA_TEST_USER_EMAIL ?? "beta@tasks.gmac.io";

function nowIsoDate(offsetMinutes: number): Date {
  const now = new Date();
  return new Date(now.getTime() + offsetMinutes * 60 * 1000);
}

async function ensureWorkspace(db: ReturnType<typeof createDb>) {
  const workspaceId = `e2e-${randomUUID()}`;

  await db
    .insert(users)
    .values({
      id: BETA_TEST_USER_ID,
      email: BETA_TEST_USER_EMAIL,
      name: "Beta Test User",
    })
    .onConflictDoNothing({ target: users.id });

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Test Workspace",
      slug: workspaceId,
      ownerId: BETA_TEST_USER_ID,
    })
    .returning();

  if (!workspace) {
    throw new Error("Failed to create test workspace for ForgeGraph fixture");
  }

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: BETA_TEST_USER_ID,
    role: "admin",
  });

  return {
    id: workspace.id,
    slug: workspaceId,
  };
}

export async function seedForgeGraphFixture(): Promise<ForgeGraphFixture> {
  const db = createDb();
  const { id: workspaceId, slug: workspaceSlug } = await ensureWorkspace(db);
  const runId = `run-${randomUUID()}`;
  const revisionId = `rev-${randomUUID()}`;
  const repoTag = randomUUID().slice(0, 12);
  const projectIds: string[] = [];

  const [repository] = await db
    .insert(forgeRepositories)
    .values({
      workspaceId,
      name: `e2e-forge-repo-${repoTag}`,
      storagePrefix: `forgegraph/e2e/${repoTag}`,
      defaultBaseBookmark: "main",
      defaultIntegrationBookmark: "integration",
    })
    .returning();

  if (!repository) {
    throw new Error("Failed to create test forge repository for e2e");
  }

  const [project] = await db
    .insert(projects)
    .values({
      workspaceId,
      name: `E2E Forge Project ${repoTag.slice(0, 8)}`,
      key: `FG${repoTag.slice(0, 6).toUpperCase()}`,
      forgeRepositoryId: repository.id,
    })
    .returning();

  if (project) {
    projectIds.push(project.id);
  }

  const [revision] = await db
    .insert(forgeRevisions)
    .values({
      repoId: repository.id,
      revId: revisionId,
      changeId: `chg-${repoTag}`,
      description: "Automated end-to-end review fixture",
      parentRevIds: [`parent-${repoTag}`],
      bookmarks: ["main", "integration"],
      metadata: {
        runId,
        files: [
          {
            path: "src/web/feature.ts",
            status: "modified",
            additions: 12,
            deletions: 2,
            diff: "@@ -1,5 +1,7 @@\n+new code\n-changed",
          },
          {
            path: "src/web/utils.ts",
            status: "added",
            additions: 42,
            deletions: 0,
            diff: "@@ -0,0 +1,3 @@\n+export const sample = true;",
          },
        ],
        pullRequests: [
          {
            id: "123",
            title: "Add web forge review fixtures",
            url: "https://github.com/linear/pull/123",
            state: "open",
            sourceBranch: "feature/forge-e2e",
            targetBranch: "main",
            number: "123",
          },
          "https://github.com/linear/agent-pr-77",
        ],
        ciNotes: ["CI passed with staged artifacts", "No regressions detected"],
      },
    })
    .returning();

  if (!revision) {
    throw new Error("Failed to create test forge revision for e2e");
  }

  await db.insert(forgeRunOverlays).values({
    runId,
    repoId: repository.id,
    revId: revision.revId,
    status: "tests_finished",
    testStatus: "passed",
    artifactRefs: [
      { type: "log", url: "https://example.com/forge-log.txt", description: "run log" },
      { type: "junit", url: "https://example.com/junit.xml", description: "junit" },
    ],
    timestamps: {
      createdAt: nowIsoDate(-25).toISOString(),
      updatedAt: nowIsoDate(-10).toISOString(),
      testsStartedAt: nowIsoDate(-20).toISOString(),
      testsFinishedAt: nowIsoDate(-10).toISOString(),
    },
  });

  const [passedBuild] = await db
    .insert(forgeBuilds)
    .values({
      repoId: repository.id,
      revId: revision.revId,
      runId,
      status: "passed",
      idempotencyKey: `build-${repoTag}-passed`,
      ciProvider: "github_actions",
      startedAt: nowIsoDate(-15),
      completedAt: nowIsoDate(-11),
      externalJobId: "build-passed-001",
    })
    .returning();

  const [failedBuild] = await db
    .insert(forgeBuilds)
    .values({
      repoId: repository.id,
      revId: revision.revId,
      runId,
      status: "failed",
      idempotencyKey: `build-${repoTag}-failed`,
      ciProvider: "github_actions",
      startedAt: nowIsoDate(-8),
      completedAt: nowIsoDate(-6),
      externalJobId: "build-failed-001",
    })
    .returning();

  if (!passedBuild || !failedBuild) {
    throw new Error("Failed to create test forge builds for e2e");
  }

  await db.insert(forgeBuildArtifacts).values([
    {
      buildId: passedBuild.id,
      type: "junit",
      digest: "sha256:passedfixture",
      storageKey: `artifacts/${repoTag}/junit-passed.xml`,
      sizeBytes: 2048,
      metadata: {
        url: "https://example.com/artifacts/passed-junit.xml",
      },
    },
    {
      buildId: failedBuild.id,
      type: "log",
      digest: "sha256:failedfixture",
      storageKey: `artifacts/${repoTag}/build-failed.log`,
      sizeBytes: 1024,
      metadata: {
        url: "https://example.com/artifacts/failed-build.log",
      },
    },
  ]);

  return {
    workspaceId,
    workspaceSlug,
    projectIds,
    repositoryId: repository.id,
    revisionId: revision.revId,
    runId,
    buildIds: [passedBuild.id, failedBuild.id],
  };
}

export async function cleanupForgeGraphFixture(fixture?: ForgeGraphFixture | null): Promise<void> {
  if (!fixture) {
    return;
  }

  const db = createDb();
  const buildIds = fixture.buildIds ?? [];

  if (buildIds.length > 0) {
    await db.delete(forgeBuildArtifacts).where(inArray(forgeBuildArtifacts.buildId, buildIds));
    await db.delete(forgeBuilds).where(inArray(forgeBuilds.id, buildIds));
  }

  if (fixture.projectIds.length > 0) {
    await db.delete(projects).where(inArray(projects.id, fixture.projectIds));
  } else {
    await db.delete(projects).where(eq(projects.workspaceId, fixture.workspaceId));
  }

  if (fixture.repositoryId) {
    await db
      .delete(forgeRevisions)
      .where(
        and(
          eq(forgeRevisions.repoId, fixture.repositoryId),
          eq(forgeRevisions.revId, fixture.revisionId)
        )
      );

    await db.delete(forgeRunOverlays).where(eq(forgeRunOverlays.runId, fixture.runId));
    await db.delete(forgeRepositories).where(eq(forgeRepositories.id, fixture.repositoryId));
  }

  if (fixture.workspaceId) {
    await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  }
}
