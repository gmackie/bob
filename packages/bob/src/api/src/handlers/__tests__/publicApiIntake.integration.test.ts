import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { makePgliteDb } from "@bob/db/client-pglite";
import {
  forgeBuilds,
  forgeDeployments,
  forgeRevisions,
  forgeRunEvents,
  repositories,
  taskRuns,
  tenantMembers,
  tenants,
  user,
  workspaces,
} from "@bob/db/schema";

import {
  publicApiCreateProject,
  publicApiCreateTask,
  publicApiLookupIntake,
} from "../publicApi.js";

describe("public OODA intake", () => {
  let handle: PgliteDbHandle;
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const ctx = {
    get db() {
      return handle.db as never;
    },
    userId: "user-1",
  };

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
    await handle.db.insert(user).values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
    });
    const [tenant] = await handle.db
      .insert(tenants)
      .values({ name: "Personal", slug: "personal" })
      .returning();
    if (!tenant) throw new Error("Tenant fixture was not created");
    await handle.db.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: "user-1",
      role: "owner",
    });
    await handle.db.insert(workspaces).values({
      id: workspaceId,
      ownerUserId: "user-1",
      tenantId: tenant.id,
      name: "Bob",
      slug: "bob",
    });
  });

  afterAll(async () => handle.close());

  it("creates exactly one project for repeated delivery", async () => {
    const input = {
      workspaceId,
      name: "Voice inbox",
      description: "Durable voice capture",
      tasks: ["Capture", "Reconcile"],
      acceptanceCriteria: ["No lost turns"],
      idempotencyKey: "delivery-project-1",
      source: {
        system: "ooda" as const,
        proposalId: "proposal-1",
        conversationId: "conversation-1",
        proposalVersion: 2,
      },
    };

    const created = await publicApiCreateProject(ctx, input);
    const replay = await publicApiCreateProject(ctx, input);

    expect(created).toMatchObject({
      kind: "project",
      replayed: false,
      name: "Voice inbox",
    });
    expect(replay).toMatchObject({
      kind: "project",
      replayed: true,
      id: created.id,
    });
    expect(created.workItems).toHaveLength(2);
    expect(replay.workItems).toEqual(created.workItems);
    await expect(
      publicApiCreateProject(ctx, { ...input, name: "Different command" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("collapses concurrent project delivery onto the destination identity", async () => {
    const input = {
      workspaceId,
      name: "Concurrent intake",
      tasks: ["Only once"],
      acceptanceCriteria: ["One project exists"],
      idempotencyKey: "delivery-project-concurrent",
      source: {
        system: "ooda" as const,
        proposalId: "proposal-concurrent",
        conversationId: "conversation-1",
        proposalVersion: 2,
      },
    };

    const results = await Promise.all([
      publicApiCreateProject(ctx, input),
      publicApiCreateProject(ctx, input),
    ]);

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.every((result) => result.workItems.length === 1)).toBe(true);
  });

  it("creates and looks up exactly one backlog task", async () => {
    const input = {
      workspaceId,
      title: "Wire delivery receipt",
      description: "Close the loop",
      acceptanceCriteria: ["Receipt deep-links to Bob"],
      idempotencyKey: "delivery-task-1",
      source: {
        system: "ooda" as const,
        proposalId: "proposal-2",
        conversationId: "conversation-1",
        proposalVersion: 2,
      },
    };

    const created = await publicApiCreateTask(ctx, input);
    const replay = await publicApiCreateTask(ctx, input);
    const lookup = await publicApiLookupIntake(ctx, {
      workspaceId,
      idempotencyKey: input.idempotencyKey,
    });

    expect(created).toMatchObject({
      kind: "work_item",
      replayed: false,
      status: "backlog",
    });
    expect(replay).toMatchObject({ replayed: true, id: created.id });
    expect(lookup).toMatchObject({
      kind: "work_item",
      replayed: true,
      id: created.id,
    });

    const [repository] = await handle.db
      .insert(repositories)
      .values({
        userId: "user-1",
        workspaceId,
        name: "bob",
        path: "/Volumes/dev/bob/bob",
        branch: "feat/evidence",
      })
      .returning();
    if (!repository) throw new Error("Repository fixture was not created");
    const [run] = await handle.db
      .insert(taskRuns)
      .values({
        userId: "user-1",
        planningWorkspaceId: workspaceId,
        planningItemId: created.id,
        planningItemIdentifier: "BOB-1",
        workItemId: created.id,
        repositoryId: repository.id,
        status: "completed",
        branch: "feat/evidence",
      })
      .returning();
    if (!run) throw new Error("Task run fixture was not created");
    const [revision] = await handle.db
      .insert(forgeRevisions)
      .values({
        repoId: repository.id,
        revId: "abc123",
        taskId: created.id,
        taskRunId: run.id,
        branch: "feat/evidence",
        status: "merged",
      })
      .returning();
    if (!revision) throw new Error("Revision fixture was not created");
    const [build] = await handle.db
      .insert(forgeBuilds)
      .values({
        revisionId: revision.id,
        repoId: repository.id,
        status: "passed",
        idempotencyKey: "build-1",
        imageDigest: "sha256:abc",
      })
      .returning();
    if (!build) throw new Error("Build fixture was not created");
    await handle.db.insert(forgeDeployments).values({
      revisionId: revision.id,
      buildId: build.id,
      repoId: repository.id,
      environment: "prod",
      status: "healthy",
    });
    await handle.db.insert(forgeRunEvents).values({
      runId: run.id,
      repoId: repository.id,
      revisionId: revision.id,
      taskId: created.id,
      eventType: "tests_finished",
      testStatus: "passed",
    });

    const observed = await publicApiLookupIntake(ctx, {
      workspaceId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(observed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "bob",
          kind: "run",
          status: "completed",
        }),
        expect.objectContaining({
          source: "kanbanger",
          kind: "work_item",
          externalId: created.id,
        }),
        expect.objectContaining({
          source: "forgegraph",
          kind: "revision",
          status: "merged",
        }),
        expect.objectContaining({
          source: "forgegraph",
          kind: "build",
          status: "passed",
        }),
        expect.objectContaining({
          source: "forgegraph",
          kind: "deployment",
          status: "healthy",
        }),
      ]),
    );
  });

  it("returns NOT_FOUND for an unknown or foreign-tenant intake", async () => {
    await expect(
      publicApiLookupIntake(ctx, { workspaceId, idempotencyKey: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
