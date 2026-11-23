import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));

vi.mock("../planningProvider.js", () => ({
  resolvePlanningProvider: vi.fn(() => Promise.resolve({ createTask })),
  PlanningProviderError: class PlanningProviderError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly retriable: boolean,
    ) {
      super(message);
    }
  },
}));

import { commitOpenPlanningDrafts } from "../commitPlanningDrafts.js";
import { PlanningProviderError } from "../planningProvider.js";

function database(input: {
  session?: { userId: string; sessionType: string } | null;
  drafts?: Record<string, unknown>[];
  project?: Record<string, unknown> | null;
  existingWorkItem?: { id: string } | null;
}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const db = {
    query: {
      chatConversations: {
        findFirst: vi.fn(() => Promise.resolve(input.session ?? null)),
      },
      planDrafts: {
        findMany: vi.fn(() => Promise.resolve(input.drafts ?? [])),
      },
      projects: {
        findFirst: vi.fn(() => Promise.resolve(input.project ?? null)),
      },
      workItems: {
        findFirst: vi.fn(() => Promise.resolve(input.existingWorkItem ?? null)),
      },
    },
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          updates.push(values);
          return Promise.resolve();
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: vi.fn(() => Promise.resolve([{ id: "work-1" }])),
          }),
        };
      },
    })),
  };
  return { db: db as never, updates, inserts };
}

describe("commitOpenPlanningDrafts", () => {
  beforeEach(() => {
    createTask.mockReset();
  });

  it("creates a Kanbanger issue and links the local work item", async () => {
    createTask.mockResolvedValue({
      externalId: "issue-1",
      identifier: "BOB-12",
      title: "Add the panel",
      description: "Show the tasks.",
    });
    const { db, updates, inserts } = database({
      session: { userId: "user-1", sessionType: "planning" },
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        planningProvider: "linear",
        linearProjectId: "kanban-project",
      },
      drafts: [
        {
          id: "draft-1",
          projectId: "project-1",
          title: "Add the panel",
          description: "Show the tasks.",
          priority: "high",
          planningTaskId: null,
          planningTaskIdentifier: null,
        },
      ],
    });

    const result = await commitOpenPlanningDrafts(db, "session-1");

    expect(createTask).toHaveBeenCalledWith({
      title: "Add the panel",
      description: "Show the tasks.",
      providerProjectId: "kanban-project",
      priority: "high",
    });
    expect(inserts).toEqual([
      expect.objectContaining({
        externalId: "issue-1",
        externalProvider: "linear",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ]);
    expect(updates).toEqual([
      { planningTaskId: "issue-1", planningTaskIdentifier: "BOB-12" },
      { workItemId: "work-1", status: "committed" },
    ]);
    expect(result).toEqual({
      committed: 1,
      workspaceId: "workspace-1",
      retry: false,
      tasks: [{ draftId: "draft-1", taskId: "work-1", identifier: "BOB-12" }],
    });
  });

  it("does not create a second issue when the draft already has one", async () => {
    const { db, inserts } = database({
      session: { userId: "user-1", sessionType: "planning" },
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        planningProvider: "linear",
        linearProjectId: "kanban-project",
      },
      existingWorkItem: { id: "work-1" },
      drafts: [
        {
          id: "draft-1",
          projectId: "project-1",
          title: "Add the panel",
          description: null,
          priority: "high",
          planningTaskId: "issue-1",
          planningTaskIdentifier: "BOB-12",
        },
      ],
    });

    const result = await commitOpenPlanningDrafts(db, "session-1");

    expect(createTask).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
    expect(result.tasks).toEqual([
      { draftId: "draft-1", taskId: "work-1", identifier: "BOB-12" },
    ]);
    expect(result.retry).toBe(false);
  });

  it("asks for a retry when the board is unavailable", async () => {
    createTask.mockRejectedValue(
      new PlanningProviderError("rate limit", "RATE_LIMITED", true),
    );
    const { db } = database({
      session: { userId: "user-1", sessionType: "planning" },
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        planningProvider: "linear",
        linearProjectId: "kanban-project",
      },
      drafts: [
        {
          id: "draft-1",
          projectId: "project-1",
          title: "Add the panel",
          description: null,
          priority: "high",
          planningTaskId: null,
          planningTaskIdentifier: null,
        },
      ],
    });

    const result = await commitOpenPlanningDrafts(db, "session-1");

    expect(result).toMatchObject({ committed: 0, retry: true, tasks: [] });
  });

  it("leaves a non-planning session untouched", async () => {
    const { db } = database({
      session: { userId: "user-1", sessionType: "execution" },
    });

    await expect(commitOpenPlanningDrafts(db, "session-1")).resolves.toEqual({
      committed: 0,
      workspaceId: null,
      tasks: [],
      retry: false,
    });
    expect(createTask).not.toHaveBeenCalled();
  });
});
