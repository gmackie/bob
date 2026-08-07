import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { makePgliteDb } from "@bob/db/client-pglite";
import { tenantMembers, tenants, user, workspaces } from "@bob/db/schema";

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
  });

  it("returns NOT_FOUND for an unknown or foreign-tenant intake", async () => {
    await expect(
      publicApiLookupIntake(ctx, { workspaceId, idempotencyKey: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
