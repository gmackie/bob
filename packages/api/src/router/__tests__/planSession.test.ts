import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { chatConversations, planDrafts } from "@bob/db/schema";

let appRouter: typeof import("../../root").appRouter;

const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn();

const dbDeleteMock = vi.fn();
const dbDeleteWhereMock = vi.fn();

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);

    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);

        return {
          returning: () => dbInsertReturningMock(),
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
});

// Valid v4 UUIDs for test inputs
const WORKSPACE_ID = "f47ac10b-58cc-4372-a567-0d02b2c3d479";
const PROJECT_ID = "6ba7b810-9dad-41d8-80b4-00c04fd430c8";
const SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DRAFT_ID = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

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
    dbDeleteMock.mockReset();
    dbDeleteWhereMock.mockReset();
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
});
