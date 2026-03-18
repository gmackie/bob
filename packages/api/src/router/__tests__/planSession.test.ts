import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatConversations,
  planDraftDependencies,
  planDrafts,
} from "@bob/db/schema";

let appRouter: typeof import("../../root").appRouter;

const startPlanningSessionMock = vi.fn();

vi.mock("@bob/execution/planning/startPlanningSession", () => ({
  startPlanningSession: startPlanningSessionMock,
}));

const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn();
const dbInsertOnConflictMock = vi.fn();

const dbDeleteMock = vi.fn();
const dbDeleteWhereMock = vi.fn();

const dbUpdateMock = vi.fn();
const dbUpdateSetMock = vi.fn();
const dbUpdateWhereMock = vi.fn();
const dbUpdateReturningMock = vi.fn();

const dbQueryFindFirstMock = vi.fn();
const dbQueryFindManyMock = vi.fn();

// Valid v4 UUIDs for test inputs
const WORKSPACE_ID = "f47ac10b-58cc-4372-a567-0d02b2c3d479";
const PROJECT_ID = "6ba7b810-9dad-41d8-80b4-00c04fd430c8";
const SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DRAFT_ID = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRAFT_ID_2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const DEP_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);

    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);

        return {
          returning: () => dbInsertReturningMock(),
          onConflictDoUpdate: (opts: unknown) => {
            dbInsertOnConflictMock(opts);
            return { returning: () => dbInsertReturningMock() };
          },
        };
      },
    };
  },
  delete: (table: unknown) => {
    dbDeleteMock(table);

    return {
      where: (condition: unknown) => {
        dbDeleteWhereMock(condition);
        return Promise.resolve();
      },
    };
  },
  update: (table: unknown) => {
    dbUpdateMock(table);

    return {
      set: (values: unknown) => {
        dbUpdateSetMock(values);

        return {
          where: (condition: unknown) => {
            dbUpdateWhereMock(condition);
            return {
              returning: () => dbUpdateReturningMock(),
            };
          },
        };
      },
    };
  },
  query: {
    chatConversations: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("chatConversations", ...args),
      findMany: (...args: unknown[]) => dbQueryFindManyMock("chatConversations", ...args),
    },
    planDrafts: {
      findMany: (...args: unknown[]) => dbQueryFindManyMock("planDrafts", ...args),
    },
    planDraftDependencies: {
      findMany: (...args: unknown[]) => dbQueryFindManyMock("planDraftDependencies", ...args),
    },
    projects: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("projects", ...args),
    },
  },
});

const createCaller = (session: { id: string }) =>
  appRouter.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        userId: session.id,
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: session.id,
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
      },
    },
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null as any,
    db: makeDbMock() as any,
  });

describe("planSession router", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertReturningMock.mockReset();
    dbInsertOnConflictMock.mockReset();
    dbDeleteMock.mockReset();
    dbDeleteWhereMock.mockReset();
    dbUpdateMock.mockReset();
    dbUpdateSetMock.mockReset();
    dbUpdateWhereMock.mockReset();
    dbUpdateReturningMock.mockReset();
    dbQueryFindFirstMock.mockReset();
    dbQueryFindManyMock.mockReset();
    startPlanningSessionMock.mockReset();
  });

  describe("create", () => {
    it("inserts a chatConversation with sessionType 'planning' and agentType 'claude'", async () => {
      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: SESSION_ID,
          userId: "user-1",
          workingDirectory: "/repo",
          agentType: "claude",
          sessionType: "planning",
          title: "Planning session",
          status: "provisioning",
        } as any,
      ]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.create({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        workingDirectory: "/repo",
      });

      expect(dbInsertMock).toHaveBeenCalledWith(chatConversations);
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          agentType: "claude",
          sessionType: "planning",
          status: "provisioning",
        }),
      );
      expect(result).toMatchObject({
        id: SESSION_ID,
        sessionType: "planning",
      });
    });
  });

  describe("createDraft", () => {
    it("inserts a planDrafts row with the provided fields", async () => {
      const draftRow = {
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        title: "Implement login",
        description: "Add login page",
        kind: "task",
        priority: "high",
        sortOrder: 0,
        status: "draft",
      };

      dbInsertReturningMock.mockResolvedValueOnce([draftRow]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.createDraft({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        title: "Implement login",
        description: "Add login page",
        kind: "task",
        priority: "high",
      });

      expect(dbInsertMock).toHaveBeenCalledWith(planDrafts);
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Implement login",
          description: "Add login page",
          kind: "task",
          priority: "high",
        }),
      );
      expect(result).toMatchObject({ id: DRAFT_ID, title: "Implement login" });
    });
  });

  describe("start", () => {
    it("passes the project's React frontend capability into execution planning startup", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: PROJECT_ID,
        automationSettings: {
          reactFrontend: true,
        },
      });
      startPlanningSessionMock.mockResolvedValueOnce({ sessionId: SESSION_ID });

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.start({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        projectName: "Acme App",
        workingDirectory: "/repo",
      });

      expect(startPlanningSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          projectId: PROJECT_ID,
          reactFrontend: true,
        }),
      );
      expect(result).toEqual({ sessionId: SESSION_ID });
    });
  });

  describe("removeDraft", () => {
    it("deletes the planDrafts row by id", async () => {
      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.removeDraft({
        id: DRAFT_ID,
      });

      expect(dbDeleteMock).toHaveBeenCalledWith(planDrafts);
      expect(result).toEqual({ ok: true });
    });
  });

  describe("get", () => {
    it("returns session + drafts + dependencies", async () => {
      const sessionRow = {
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      };
      const draftRows = [
        { id: DRAFT_ID, sessionId: SESSION_ID, title: "Draft 1" },
        { id: DRAFT_ID_2, sessionId: SESSION_ID, title: "Draft 2" },
      ];
      const depRows = [
        { id: DEP_ID, draftId: DRAFT_ID_2, dependsOnDraftId: DRAFT_ID },
      ];

      dbQueryFindFirstMock.mockResolvedValueOnce(sessionRow);
      dbQueryFindManyMock
        .mockResolvedValueOnce(draftRows) // planDrafts.findMany
        .mockResolvedValueOnce(depRows); // planDraftDependencies.findMany

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.get({
        sessionId: SESSION_ID,
      });

      expect(dbQueryFindFirstMock).toHaveBeenCalledWith(
        "chatConversations",
        expect.anything(),
      );
      expect(result).toMatchObject({
        session: { id: SESSION_ID },
        drafts: draftRows,
        dependencies: depRows,
      });
    });

    it("returns null when session not found", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.get({
        sessionId: SESSION_ID,
      });

      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("returns planning sessions for current user", async () => {
      const sessions = [
        { id: SESSION_ID, userId: "user-1", sessionType: "planning" },
      ];

      dbQueryFindManyMock.mockResolvedValueOnce(sessions);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.list({});

      expect(dbQueryFindManyMock).toHaveBeenCalledWith(
        "chatConversations",
        expect.anything(),
      );
      expect(result).toEqual(sessions);
    });
  });

  describe("updateDraft", () => {
    it("changes draft fields", async () => {
      const updatedDraft = {
        id: DRAFT_ID,
        title: "Updated title",
        priority: "medium",
      };

      dbUpdateReturningMock.mockResolvedValueOnce([updatedDraft]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.updateDraft({
        id: DRAFT_ID,
        title: "Updated title",
        priority: "medium",
      });

      expect(dbUpdateMock).toHaveBeenCalledWith(planDrafts);
      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Updated title",
          priority: "medium",
        }),
      );
      expect(result).toMatchObject({ id: DRAFT_ID, title: "Updated title" });
    });
  });

  describe("setDependency", () => {
    it("creates dependency link", async () => {
      const depRow = {
        id: DEP_ID,
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      };

      dbInsertReturningMock.mockResolvedValueOnce([depRow]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.setDependency({
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      });

      expect(dbInsertMock).toHaveBeenCalledWith(planDraftDependencies);
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          draftId: DRAFT_ID_2,
          dependsOnDraftId: DRAFT_ID,
        }),
      );
      expect(result).toMatchObject({
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      });
    });
  });

  describe("removeDependency", () => {
    it("deletes dependency link", async () => {
      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.removeDependency({
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      });

      expect(dbDeleteMock).toHaveBeenCalledWith(planDraftDependencies);
      expect(result).toEqual({ ok: true });
    });
  });

  describe("commitPlan", () => {
    it("marks drafts as committed via planning API", async () => {
      const drafts = [
        {
          id: DRAFT_ID,
          sessionId: SESSION_ID,
          projectId: PROJECT_ID,
          title: "Task A",
          description: "Do A",
          priority: "high",
          status: "draft",
        },
      ];

      // findMany for drafts
      dbQueryFindManyMock.mockResolvedValueOnce(drafts);

      // Set PLANNING_API_KEY so commitPlan doesn't throw
      process.env.PLANNING_API_KEY = "test-api-key";

      // Mock global fetch
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            result: {
              data: {
                json: { id: "task-1", identifier: "TSK-1" },
              },
            },
          },
        ],
      } as any);

      // update().set().where() for marking committed (no returning)
      dbUpdateMock.mockReturnValue({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      });

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.commitPlan({
        sessionId: SESSION_ID,
      });

      expect(result.committed).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        draftId: DRAFT_ID,
        taskId: "task-1",
        identifier: "TSK-1",
      });

      fetchSpy.mockRestore();
      delete process.env.PLANNING_API_KEY;
    });

    it("returns { committed: 0 } when no drafts exist", async () => {
      dbQueryFindManyMock.mockResolvedValueOnce([]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.commitPlan({
        sessionId: SESSION_ID,
      });

      expect(result).toEqual({ committed: 0, tasks: [] });
    });
  });
});
