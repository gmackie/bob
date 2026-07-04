import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/test";

type MockDb = ReturnType<typeof createMockDb>;

const createMockDb = () => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn((values: Record<string, unknown>) => ({
    returning: insertReturning,
  }));
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({
    returning: updateReturning,
  }));
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));
  const update = vi.fn(() => ({
    set: updateSet,
  }));

  return {
    query: {
      tenantMembers: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      workspaces: {
        findFirst: vi.fn(),
      },
      repositories: {
        findFirst: vi.fn(),
      },
      agentRuns: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert,
    update,
    __mock: {
      insertReturning,
      insertValues,
      updateReturning,
      updateWhere,
      updateSet,
    },
  };
};

let createCaller: (db: MockDb) => ReturnType<any>;

beforeAll(async () => {
  const { createTRPCRouter } = await import("../../trpc");
  const { publicApiRouter } = await import("../publicApi");

  const router = createTRPCRouter({
    publicApi: publicApiRouter,
  });

  createCaller = (db: MockDb) =>
    router.createCaller({
      session: {
        user: {
          id: "user-1",
        },
      },
      authApi: {
        getSession: vi.fn(),
      },
      apiKeyAuth: {
        keyId: "key-1",
        permissions: ["read", "write", "delete", "admin"],
        user: {
          id: "user-1",
        },
        userId: "user-1",
      },
      db,
    } as any);
});

describe("publicApi router tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
  });

  it("rejects getRun for runs outside the caller tenant", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.agentRuns.findFirst.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: "tenant-2",
      workItemId: "BOB-42",
      artifacts: [],
    });

    const caller = createCaller(db);

    await expect(
      caller.publicApi.getRun({
        runId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects listRuns for workspaces outside the caller tenant", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.workspaces.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      tenantId: "tenant-2",
    });

    const caller = createCaller(db);

    await expect(
      caller.publicApi.listRuns({
        workspaceId: "22222222-2222-4222-8222-222222222222",
        limit: 20,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns no work-item runs when the caller has no tenant memberships", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([]);
    db.query.agentRuns.findMany.mockResolvedValueOnce([
      {
        id: "run-1",
        tenantId: "tenant-2",
        workItemId: "BOB-42",
      },
    ]);

    const caller = createCaller(db);

    await expect(
      caller.publicApi.listRunsByWorkItem({
        workItemId: "BOB-42",
        limit: 20,
      }),
    ).resolves.toEqual([]);
  });

  it("rejects createRun for workspaces outside the caller tenant", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.workspaces.findFirst.mockResolvedValueOnce({
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: "tenant-2",
    });
    db.__mock.insertReturning.mockResolvedValueOnce([
      {
        id: "44444444-4444-4444-8444-444444444444",
        tenantId: "tenant-2",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        workItemId: "BOB-42",
        status: "queued",
      },
    ]);

    const caller = createCaller(db);

    await expect(
      caller.publicApi.createRun({
        workItemId: "BOB-42",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        agentType: "claude",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("publishes provider capacity changes when a run is created", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.workspaces.findFirst.mockResolvedValueOnce({
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: "tenant-1",
    });
    db.__mock.insertReturning.mockResolvedValueOnce([
      {
        id: "77777777-7777-4777-8777-777777777777",
        tenantId: "tenant-1",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        workItemId: "BOB-42",
        status: "queued",
        agentType: "codex",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";

    const caller = createCaller(db);

    await caller.publicApi.createRun({
      workItemId: "BOB-42",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      agentType: "codex",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer shh",
        }),
        body: JSON.stringify({
          type: "provider_capacity_changed",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          entityId: "77777777-7777-4777-8777-777777777777",
          payload: {
            changed: ["agentRun"],
            runId: "77777777-7777-4777-8777-777777777777",
            status: "queued",
            agentType: "codex",
            workItemId: "BOB-42",
          },
        }),
      }),
    );
  });

  it("publishes provider capacity changes when a run status changes", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.agentRuns.findFirst.mockResolvedValueOnce({
      id: "88888888-8888-4888-8888-888888888888",
      tenantId: "tenant-1",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      workItemId: "BOB-42",
      agentType: "cursor",
    });
    db.__mock.updateReturning.mockResolvedValueOnce([
      {
        id: "88888888-8888-4888-8888-888888888888",
        tenantId: "tenant-1",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        workItemId: "BOB-42",
        status: "completed",
        agentType: "cursor",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";

    const caller = createCaller(db);

    await caller.publicApi.updateRun({
      runId: "88888888-8888-4888-8888-888888888888",
      status: "completed",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer shh",
        }),
        body: JSON.stringify({
          type: "provider_capacity_changed",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          entityId: "88888888-8888-4888-8888-888888888888",
          payload: {
            changed: ["agentRun"],
            runId: "88888888-8888-4888-8888-888888888888",
            status: "completed",
            agentType: "cursor",
            workItemId: "BOB-42",
          },
        }),
      }),
    );
  });

  it("publishes session output changes when a run artifact is created", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.agentRuns.findFirst.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      tenantId: "tenant-1",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      workItemId: "BOB-42",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    db.__mock.insertReturning.mockResolvedValueOnce([
      {
        id: "artifact-1",
        runId: "99999999-9999-4999-8999-999999999999",
        type: "test-report",
        storageKey: "runs/999/test-report.json",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";

    const caller = createCaller(db);

    await caller.publicApi.createArtifact({
      runId: "99999999-9999-4999-8999-999999999999",
      type: "test-report",
      storageKey: "runs/999/test-report.json",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer shh",
        }),
        body: JSON.stringify({
          type: "session_event_appended",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          payload: {
            changed: ["artifact"],
            runId: "99999999-9999-4999-8999-999999999999",
            artifactId: "artifact-1",
            artifactType: "test-report",
            workItemId: "BOB-42",
          },
        }),
      }),
    );
  });

  it("registerWorkspace adds the caller as an owner workspace member", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findFirst
      .mockResolvedValueOnce({
        tenantId: "tenant-1",
        tenant: { id: "tenant-1" },
      });
    db.__mock.insertReturning
      .mockResolvedValueOnce([
        {
          id: "55555555-5555-4555-8555-555555555555",
          tenantId: "tenant-1",
          name: "Bob CLI",
          slug: "bob-cli",
        },
      ])
      .mockResolvedValueOnce([{ id: "member-1" }]);

    const caller = createCaller(db);

    await caller.publicApi.registerWorkspace({
      name: "Bob CLI",
      slug: "bob-cli",
      machineId: "labnuc",
    });

    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.__mock.insertValues.mock.calls[1]?.[0]).toMatchObject({
      workspaceId: "55555555-5555-4555-8555-555555555555",
      userId: "user-1",
      role: "owner",
    });
  });

  it("publishes git status changes when heartbeat updates discovered repositories", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.workspaces.findFirst.mockResolvedValueOnce({
      id: "66666666-6666-4666-8666-666666666666",
      tenantId: "tenant-1",
    });
    db.query.repositories.findFirst.mockResolvedValueOnce({
      id: "repo-1",
      remoteUrl: "git@github.com:acme/app.git",
      branch: "main",
      buildSystem: "pnpm",
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";

    const caller = createCaller(db);

    await caller.publicApi.heartbeat({
      workspaceId: "66666666-6666-4666-8666-666666666666",
      repos: [
        {
          name: "app",
          path: "/repos/app",
          isGit: true,
          remoteUrl: "git@github.com:acme/app.git",
          branch: "feature/tablet-dashboard",
          dirty: true,
          buildSystem: "pnpm",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer shh",
        }),
        body: JSON.stringify({
          type: "git_status_changed",
          workspaceId: "66666666-6666-4666-8666-666666666666",
          entityId: "repo-1",
          payload: {
            changed: ["repository", "gitStatus"],
            repositoryIds: ["repo-1"],
          },
        }),
      }),
    );
  });
});
