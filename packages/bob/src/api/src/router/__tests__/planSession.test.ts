import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatConversations,
  planDraftDependencies,
  planDrafts,
} from "@bob/db/schema";

let appRouter: typeof import("../../root").appRouter;

// planSession.start now writes to chat_conversations + best-effort nudges
// the ws-gateway over HTTP instead of delegating to @bob/execution.
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", fetchMock);

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

function containsColumnName(value: unknown, columnName: string, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if ((value as { name?: unknown }).name === columnName) return true;

  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (key === "table") return false;
    if (Array.isArray(entry)) {
      return entry.some((item) => containsColumnName(item, columnName, seen));
    }
    return containsColumnName(entry, columnName, seen);
  });
}

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
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    }),
  }),
  query: {
    chatConversations: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("chatConversations", ...args),
      findMany: (...args: unknown[]) => dbQueryFindManyMock("chatConversations", ...args),
    },
    planDrafts: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("planDrafts", ...args),
      findMany: (...args: unknown[]) => dbQueryFindManyMock("planDrafts", ...args),
    },
    planDraftDependencies: {
      findMany: (...args: unknown[]) => dbQueryFindManyMock("planDraftDependencies", ...args),
    },
    projects: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("projects", ...args),
    },
    workItems: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("workItems", ...args),
    },
    workspaceMembers: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("workspaceMembers", ...args),
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
    fetchMock.mockClear();
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
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

    it("rejects creation when the caller is not a member of the work item's workspace", async () => {
      dbQueryFindFirstMock
        .mockResolvedValueOnce({
          id: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
        })
        .mockResolvedValueOnce(null);

      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: SESSION_ID,
          userId: "user-1",
          sessionType: "planning",
          workItemId: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
        } as any,
      ]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.create({
          workItemId: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
          title: "Planning session",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("createDraft", () => {
    it("inserts a planDrafts row with the provided fields", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });

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

    it("publishes planning draft production for shell realtime updates", async () => {
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: DRAFT_ID,
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title: "Implement login",
          kind: "task",
          priority: "high",
          status: "draft",
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.createDraft({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        title: "Implement login",
        kind: "task",
        priority: "high",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/workspace-event",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
          body: JSON.stringify({
            type: "planning_session_produced_drafts",
            workspaceId: WORKSPACE_ID,
            entityId: SESSION_ID,
            payload: {
              action: "created",
              draftIds: [DRAFT_ID],
              projectId: PROJECT_ID,
            },
          }),
        }),
      );
    });

    it("rejects draft creation when the planning session is not owned by the caller", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce(null);
      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: DRAFT_ID,
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title: "Implement login",
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.createDraft({
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title: "Implement login",
          description: "Add login page",
          kind: "task",
          priority: "high",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("start", () => {
    it("passes the project's React frontend capability into execution planning startup", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.start({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        projectName: "Acme App",
        workingDirectory: "/repo",
      });

      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "pending",
          planningWorkspaceId: WORKSPACE_ID,
          planningProjectId: PROJECT_ID,
          planningProjectName: "Acme App",
        }),
      );
      expect(result).toEqual({ ok: true, sessionId: SESSION_ID });
    });

    it("forwards workflow launch context into execution planning startup", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.start({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        projectName: "Acme App",
        workingDirectory: "/repo",
        launchContext: {
          intent: "shape",
          notes:
            "Shape this into an epic, clarify the API surface, and keep the parent item as the scope owner.",
          workItem: {
            id: "8d236647-d217-4273-9115-f6957d77b168",
            identifier: "EPIC-42",
            title: "Improve launch workflow",
            kind: "epic",
          },
          selectedRepoSources: [
            {
              id: "repo-readme",
              label: "Project overview",
              path: "README.md",
              detail: "Product overview and current setup guidance.",
            },
          ],
          attachedFiles: [
            {
              name: "launch-brief.md",
              sizeLabel: "14 KB",
              content:
                "# Launch brief\n\nFocus the work on planning-session kickoff quality.",
            },
          ],
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/nudge",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
        }),
      );
      const nudgeBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(nudgeBody.sessionType).toBe("planning");
      expect(nudgeBody.planningContext.launchContext.intent).toBe("shape");
      expect(nudgeBody.planningContext.launchContext.workItem.identifier).toBe(
        "EPIC-42",
      );
    });

    it("rejects starting a planning session the caller does not own", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.start({
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          projectName: "Acme App",
          workingDirectory: "/repo",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("removeDraft", () => {
    it("deletes the planDrafts row by id", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.removeDraft({
        id: DRAFT_ID,
      });

      expect(dbDeleteMock).toHaveBeenCalledWith(planDrafts);
      expect(result).toEqual({ ok: true });
    });

    it("publishes planning draft changes for shell realtime updates", async () => {
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.removeDraft({
        id: DRAFT_ID,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/workspace-event",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
          body: JSON.stringify({
            type: "planning_session_produced_drafts",
            workspaceId: WORKSPACE_ID,
            entityId: SESSION_ID,
            payload: {
              action: "removed",
              draftIds: [DRAFT_ID],
              projectId: PROJECT_ID,
            },
          }),
        }),
      );
    });

    it("rejects draft deletion when the draft's session is not owned by the caller", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.removeDraft({
          id: DRAFT_ID,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
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

      dbQueryFindManyMock
        .mockResolvedValueOnce(sessions)
        .mockResolvedValueOnce([
          { id: DRAFT_ID, sessionId: SESSION_ID, status: "draft" },
          { id: DRAFT_ID_2, sessionId: SESSION_ID, status: "committed" },
        ]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.list({});

      expect(dbQueryFindManyMock).toHaveBeenCalledWith(
        "chatConversations",
        expect.anything(),
      );
      expect(dbQueryFindManyMock).toHaveBeenCalledWith(
        "planDrafts",
        expect.anything(),
      );
      expect(result).toEqual([
        {
          ...sessions[0],
          draftCount: 1,
          producedTaskCount: 1,
        },
      ]);
    });

    it("scopes planning session lists to the requested workspace", async () => {
      dbQueryFindManyMock.mockResolvedValueOnce([]);

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.list({ workspaceId: WORKSPACE_ID });

      const [, options] = dbQueryFindManyMock.mock.calls[0] ?? [];
      expect(containsColumnName((options as any).where, "planning_workspace_id")).toBe(true);
    });
  });

  describe("updateDraft", () => {
    it("changes draft fields", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });

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

    it("publishes planning draft changes for shell realtime updates", async () => {
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbUpdateReturningMock.mockResolvedValueOnce([
        {
          id: DRAFT_ID,
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title: "Updated title",
          priority: "medium",
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.updateDraft({
        id: DRAFT_ID,
        title: "Updated title",
        priority: "medium",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/workspace-event",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
          body: JSON.stringify({
            type: "planning_session_produced_drafts",
            workspaceId: WORKSPACE_ID,
            entityId: SESSION_ID,
            payload: {
              action: "updated",
              draftIds: [DRAFT_ID],
              projectId: PROJECT_ID,
            },
          }),
        }),
      );
    });

    it("rejects draft updates when the draft's session is not owned by the caller", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce(null);
      dbUpdateReturningMock.mockResolvedValueOnce([
        {
          id: DRAFT_ID,
          title: "Updated title",
          priority: "medium",
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.updateDraft({
          id: DRAFT_ID,
          title: "Updated title",
          priority: "medium",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("setDependency", () => {
    it("creates dependency link", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID_2,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });

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

    it("notifies the workspace when a draft dependency is added", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID_2,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: DEP_ID,
          draftId: DRAFT_ID_2,
          dependsOnDraftId: DRAFT_ID,
        },
      ]);
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.setDependency({
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/workspace-event",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
          body: JSON.stringify({
            type: "planning_session_produced_drafts",
            workspaceId: WORKSPACE_ID,
            entityId: SESSION_ID,
            payload: {
              action: "dependency_added",
              draftIds: [DRAFT_ID_2, DRAFT_ID],
              projectId: PROJECT_ID,
            },
          }),
        }),
      );
    });

    it("rejects dependency creation when one of the drafts is not owned by the caller", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID_2,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce(null);
      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: DEP_ID,
          draftId: DRAFT_ID_2,
          dependsOnDraftId: DRAFT_ID,
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.setDependency({
          draftId: DRAFT_ID_2,
          dependsOnDraftId: DRAFT_ID,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("removeDependency", () => {
    it("deletes dependency link", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID_2,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.removeDependency({
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      });

      expect(dbDeleteMock).toHaveBeenCalledWith(planDraftDependencies);
      expect(result).toEqual({ ok: true });
    });

    it("notifies the workspace when a draft dependency is removed", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID_2,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";

      const caller = createCaller({ id: "user-1" });

      await caller.planSession.removeDependency({
        draftId: DRAFT_ID_2,
        dependsOnDraftId: DRAFT_ID,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/workspace-event",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
          body: JSON.stringify({
            type: "planning_session_produced_drafts",
            workspaceId: WORKSPACE_ID,
            entityId: SESSION_ID,
            payload: {
              action: "dependency_removed",
              draftIds: [DRAFT_ID_2, DRAFT_ID],
              projectId: PROJECT_ID,
            },
          }),
        }),
      );
    });

    it("rejects dependency deletion when one of the drafts is not owned by the caller", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID_2,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: DRAFT_ID,
        sessionId: SESSION_ID,
      });
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.removeDependency({
          draftId: DRAFT_ID_2,
          dependsOnDraftId: DRAFT_ID,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("commitPlan", () => {
    it("marks drafts as committed via provider", async () => {
      // loadOwnedPlanningSession
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
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

      // findFirst for project lookup (inside commitPlan loop)
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        planningProvider: "internal",
        linearProjectId: null,
      });

      // InternalPlanningProvider.createTask calls insert().values().returning()
      dbInsertReturningMock.mockResolvedValueOnce([
        { id: "task-1", title: "Task A", description: "Do A", status: "draft", ownerUserId: "system", workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, kind: "task" },
      ]);

      // update().set().where() for marking committed (no returning)
      dbUpdateMock.mockReturnValue({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      });
      process.env.GATEWAY_URL = "http://gw.local";
      process.env.NUDGE_SHARED_SECRET = "shh";

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.commitPlan({
        sessionId: SESSION_ID,
      });

      expect(result.committed).toBe(1);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        draftId: DRAFT_ID,
        taskId: "task-1",
        identifier: "task-1",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://gw.local/internal/workspace-event",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer shh",
          }),
          body: JSON.stringify({
            type: "planning_session_produced_tasks",
            workspaceId: WORKSPACE_ID,
            entityId: SESSION_ID,
            payload: {
              committed: 1,
              taskIds: ["task-1"],
              draftIds: [DRAFT_ID],
            },
          }),
        }),
      );
    });

    it("returns { committed: 0 } when no drafts exist", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: SESSION_ID,
        userId: "user-1",
        sessionType: "planning",
      });
      dbQueryFindManyMock.mockResolvedValueOnce([]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.planSession.commitPlan({
        sessionId: SESSION_ID,
      });

      expect(result).toEqual({ committed: 0, tasks: [] });
    });

    it("rejects commit when the planning session is not owned by the caller", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce(null);
      dbQueryFindManyMock.mockResolvedValueOnce([]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.commitPlan({
          sessionId: SESSION_ID,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("saveArtifact", () => {
    it("rejects saving an artifact when the caller is not a member of the work item's workspace", async () => {
      dbQueryFindFirstMock
        .mockResolvedValueOnce({
          id: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
          workspaceId: WORKSPACE_ID,
        })
        .mockResolvedValueOnce(null);

      dbInsertReturningMock.mockResolvedValueOnce([
        {
          id: "artifact-1",
          workItemId: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
          sessionId: SESSION_ID,
          artifactType: "planning_doc",
          artifactRole: "shape",
          title: "Plan",
          content: "content",
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.saveArtifact({
          sessionId: SESSION_ID,
          workItemId: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
          title: "Plan",
          content: "content",
          planningSessionType: "shape",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("getPriorContext", () => {
    it("rejects reading prior context when the caller is not a member of the work item's workspace", async () => {
      dbQueryFindFirstMock
        .mockResolvedValueOnce({
          id: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
          workspaceId: WORKSPACE_ID,
        })
        .mockResolvedValueOnce(null);

      dbQueryFindManyMock.mockResolvedValueOnce([
        {
          id: "artifact-1",
          title: "Prior plan",
          sessionId: SESSION_ID,
          content: "secret planning context",
          createdAt: new Date("2026-03-10T00:00:00.000Z"),
        },
      ]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.planSession.getPriorContext({
          workItemId: "b8a0d12f-2d49-4f8c-94e8-7c4d1d9f6b10",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
