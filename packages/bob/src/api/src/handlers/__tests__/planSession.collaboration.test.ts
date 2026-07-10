import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  findManyMock,
  insertReturningMock,
  updateReturningMock,
  selectLimitMock,
  leftJoinMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateReturningMock: vi.fn(),
  selectLimitMock: vi.fn(),
  leftJoinMock: vi.fn(),
}));

vi.mock("@bob/db", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@bob/db/schema", () => ({
  agentPersonas: { slug: "slug", active: "active", id: "id" },
  chatConversations: {
    id: "chat_conversations.id",
    userId: "chat_conversations.user_id",
    sessionType: "chat_conversations.session_type",
    planningWorkspaceId: "chat_conversations.planning_workspace_id",
    workItemId: "chat_conversations.work_item_id",
    createdAt: "chat_conversations.created_at",
    status: "chat_conversations.status",
  },
  planDraftDependencies: { draftId: "plan_draft_dependencies.draft_id" },
  planDrafts: {
    id: "plan_drafts.id",
    sessionId: "plan_drafts.session_id",
    sortOrder: "plan_drafts.sort_order",
    createdAt: "plan_drafts.created_at",
    status: "plan_drafts.status",
  },
  planningSessionMessages: {
    id: "planning_session_messages.id",
    sessionId: "planning_session_messages.session_id",
    userId: "planning_session_messages.user_id",
    clientMessageId: "planning_session_messages.client_message_id",
    body: "planning_session_messages.body",
    createdAt: "planning_session_messages.created_at",
  },
  projects: { id: "projects.id" },
  repositories: { planningProjectId: "repositories.planning_project_id", path: "path" },
  runLifecycleEvents: {},
  user: { id: "user.id", name: "user.name", image: "user.image" },
  workItemArtifacts: {
    id: "work_item_artifacts.id",
    workItemId: "work_item_artifacts.work_item_id",
    sessionId: "work_item_artifacts.session_id",
    artifactType: "work_item_artifacts.artifact_type",
    contentVersion: "work_item_artifacts.content_version",
    createdAt: "work_item_artifacts.created_at",
  },
  workItemDependencies: {},
  workItems: { id: "work_items.id", workspaceId: "work_items.workspace_id" },
  workspaceMembers: {
    workspaceId: "workspace_members.workspace_id",
    userId: "workspace_members.user_id",
  },
}));

vi.mock("../../services/integrations/planningProvider.js", () => ({
  resolvePlanningProvider: vi.fn(),
}));

function makeDb() {
  const orderBy = vi.fn().mockReturnThis();
  const limit = selectLimitMock.mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ orderBy, limit, returning: updateReturningMock });
  const from = vi.fn().mockReturnValue({
    leftJoin: leftJoinMock.mockReturnValue({ where }),
    where,
  });
  const select = vi.fn().mockReturnValue({ from });

  return {
    query: {
      workspaceMembers: { findFirst: (...a: unknown[]) => findFirstMock("workspaceMembers", ...a) },
      chatConversations: {
        findFirst: (...a: unknown[]) => findFirstMock("chatConversations", ...a),
        findMany: (...a: unknown[]) => findManyMock("chatConversations", ...a),
      },
      workItems: { findFirst: (...a: unknown[]) => findFirstMock("workItems", ...a) },
      planDrafts: {
        findFirst: (...a: unknown[]) => findFirstMock("planDrafts", ...a),
        findMany: (...a: unknown[]) => findManyMock("planDrafts", ...a),
      },
      planDraftDependencies: {
        findMany: (...a: unknown[]) => findManyMock("planDraftDependencies", ...a),
      },
      workItemArtifacts: {
        findFirst: (...a: unknown[]) => findFirstMock("workItemArtifacts", ...a),
        findMany: (...a: unknown[]) => findManyMock("workItemArtifacts", ...a),
      },
      planningSessionMessages: {
        findFirst: (...a: unknown[]) => findFirstMock("planningSessionMessages", ...a),
      },
      projects: { findFirst: (...a: unknown[]) => findFirstMock("projects", ...a) },
      repositories: { findFirst: (...a: unknown[]) => findFirstMock("repositories", ...a) },
      agentPersonas: { findFirst: (...a: unknown[]) => findFirstMock("agentPersonas", ...a) },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: insertReturningMock }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: updateReturningMock }) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    select,
    transaction: vi.fn(),
  } as any;
}

describe("planSession collaboration (BOB-14)", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    findManyMock.mockReset();
    insertReturningMock.mockReset();
    updateReturningMock.mockReset();
    selectLimitMock.mockReset();
    leftJoinMock.mockReset();
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
  });

  it("allows a workspace member who is not the owner to get a planning session", async () => {
    const { planSessionGet } = await import("../planSession.js");
    const db = makeDb();

    findFirstMock.mockImplementation((table: string) => {
      if (table === "chatConversations") {
        return Promise.resolve({
          id: "session-1",
          userId: "owner",
          sessionType: "planning",
          planningWorkspaceId: "ws-1",
        });
      }
      if (table === "workspaceMembers") {
        return Promise.resolve({ id: "mem-1" });
      }
      return Promise.resolve(null);
    });
    findManyMock.mockResolvedValue([]);

    const result = await planSessionGet(
      { db, userId: "collaborator" },
      { sessionId: "session-1" },
    );

    expect(result).not.toBeNull();
    expect(result?.session.id).toBe("session-1");
  });

  it("rejects get when the caller is not a workspace member", async () => {
    const { planSessionGet } = await import("../planSession.js");
    const db = makeDb();

    findFirstMock.mockImplementation((table: string) => {
      if (table === "chatConversations") {
        return Promise.resolve({
          id: "session-1",
          userId: "owner",
          sessionType: "planning",
          planningWorkspaceId: "ws-1",
        });
      }
      if (table === "workspaceMembers") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const result = await planSessionGet(
      { db, userId: "stranger" },
      { sessionId: "session-1" },
    );

    expect(result).toBeNull();
  });

  it("sends a collab chat message and notifies the gateway", async () => {
    const { planSessionSendMessage } = await import("../planSession.js");
    const db = makeDb();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "secret";

    findFirstMock.mockImplementation((table: string) => {
      if (table === "chatConversations") {
        return Promise.resolve({
          id: "session-1",
          userId: "owner",
          sessionType: "planning",
          planningWorkspaceId: "ws-1",
        });
      }
      if (table === "workspaceMembers") {
        return Promise.resolve({ id: "mem-1" });
      }
      if (table === "planningSessionMessages") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    insertReturningMock.mockResolvedValueOnce([
      {
        id: "msg-1",
        sessionId: "session-1",
        userId: "collaborator",
        clientMessageId: "c1",
        body: "Hello team",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    selectLimitMock.mockResolvedValueOnce([{ name: "Alex", image: null }]);

    const result = await planSessionSendMessage(
      { db, userId: "collaborator" },
      {
        sessionId: "session-1",
        body: "Hello team",
        clientMessageId: "c1",
      },
    );

    expect(result.body).toBe("Hello team");
    expect(result.userName).toBe("Alex");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("planning_collab_message"),
      }),
    );

    vi.unstubAllGlobals();
  });

  it("rejects artifact update on version conflict", async () => {
    const { planSessionUpdateArtifact } = await import("../planSession.js");
    const db = makeDb();

    findFirstMock.mockImplementation((table: string) => {
      if (table === "workItemArtifacts") {
        return Promise.resolve({
          id: "art-1",
          workItemId: "wi-1",
          sessionId: "session-1",
          contentVersion: 3,
        });
      }
      if (table === "workItems") {
        return Promise.resolve({ id: "wi-1", workspaceId: "ws-1" });
      }
      if (table === "workspaceMembers") {
        return Promise.resolve({ id: "mem-1" });
      }
      if (table === "chatConversations") {
        return Promise.resolve({
          id: "session-1",
          userId: "owner",
          sessionType: "planning",
          planningWorkspaceId: "ws-1",
        });
      }
      return Promise.resolve(null);
    });

    await expect(
      planSessionUpdateArtifact(
        { db, userId: "collaborator" },
        {
          artifactId: "art-1",
          content: "new",
          expectedVersion: 2,
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
