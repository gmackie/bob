import { describe, expect, it, vi } from "vitest";

import type { HandlerContext } from "../context";
import { planningCreateTask, planningUpdateTask } from "../planning";

const { createTask, updateTask } = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("../../services/integrations/planningProvider.js", () => ({
  resolvePlanningProvider: () => Promise.resolve({ createTask, updateTask }),
}));
vi.mock("@bob/db/client", () => ({ db: {} }));

function fixture(provider: string, conflict = false) {
  const values = vi.fn(() => ({
    onConflictDoNothing: () => ({
      returning: () => Promise.resolve(conflict ? [] : [{ id: "local-id" }]),
    }),
  }));
  const db = {
    query: {
      projects: {
        findFirst: () =>
          Promise.resolve({
            id: "project",
            workspaceId: "workspace",
            planningProvider: provider,
            linearProjectId: "remote-project",
          }),
      },
      workspaceMembers: {
        findFirst: () => Promise.resolve({ id: "membership" }),
      },
      workItems: {
        findFirst: () =>
          Promise.resolve({
            id: "webhook-id",
            externalId: "provider-id",
            workspaceId: "workspace",
            projectId: "project",
          }),
      },
    },
    insert: vi.fn(() => ({ values })),
  };
  createTask.mockResolvedValue({
    externalId: provider === "internal" ? "local-id" : "provider-id",
    identifier: "TASK-1",
    title: "New work",
    description: "Details",
    status: "draft",
    priority: "no_priority",
    url: "https://example.test/task",
  });
  return {
    ctx: { db, userId: "owner" } as unknown as HandlerContext,
    db,
    values,
  };
}

describe("created task identity", () => {
  it("returns the canonical local work item for an internal task without duplicating it", async () => {
    const { ctx, db } = fixture("internal");
    expect(
      await planningCreateTask(ctx, {
        projectId: "project",
        title: "New work",
      }),
    ).toMatchObject({ id: "local-id", workItemId: "local-id" });
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("persists a local mirror before returning a remote task so planning can link immediately", async () => {
    const { ctx, values } = fixture("linear");
    expect(
      await planningCreateTask(ctx, {
        projectId: "project",
        title: "New work",
        status: "backlog",
      }),
    ).toMatchObject({ id: "provider-id", workItemId: "local-id" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: "provider-id",
        externalProvider: "linear",
        projectId: "project",
        workspaceId: "workspace",
        ownerUserId: "owner",
        status: "backlog",
      }),
    );
  });
  it("uses the existing local item if a webhook won the insert race", async () => {
    const { ctx } = fixture("linear", true);
    expect(
      await planningCreateTask(ctx, {
        projectId: "project",
        title: "New work",
      }),
    ).toMatchObject({ workItemId: "webhook-id" });
  });
});

it("updates Linear with the provider ID after creating a local work item", async () => {
  const { ctx } = fixture("linear");
  updateTask.mockResolvedValue({
    externalId: "provider-id",
    identifier: "TASK-1",
    title: "Edited",
    status: "backlog",
    priority: "no_priority",
  });
  await planningUpdateTask(ctx, { id: "local-id", title: "Edited" });
  expect(updateTask).toHaveBeenCalledWith(
    "provider-id",
    expect.objectContaining({ title: "Edited" }),
  );
});
