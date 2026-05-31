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

    const caller = createCaller(db) as any;

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

    const caller = createCaller(db) as any;

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

    const caller = createCaller(db) as any;

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

    const caller = createCaller(db) as any;

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

  it("rejects createRun for free tenants", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.workspaces.findFirst.mockResolvedValueOnce({
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: "tenant-1",
      tenant: { id: "tenant-1", plan: "free" },
    });

    const caller = createCaller(db) as any;

    await expect(
      caller.publicApi.createRun({
        workItemId: "BOB-42",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        agentType: "claude",
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates runs for paid tenants", async () => {
    const db = createMockDb();
    db.query.tenantMembers.findMany.mockResolvedValueOnce([
      { tenantId: "tenant-1" },
    ]);
    db.query.workspaces.findFirst.mockResolvedValueOnce({
      id: "33333333-3333-4333-8333-333333333333",
      tenantId: "tenant-1",
      tenant: { id: "tenant-1", plan: "pro" },
    });
    db.__mock.insertReturning.mockResolvedValueOnce([
      {
        id: "44444444-4444-4444-8444-444444444444",
        tenantId: "tenant-1",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        workItemId: "BOB-42",
        status: "queued",
      },
    ]);

    const caller = createCaller(db) as any;

    await expect(
      caller.publicApi.createRun({
        workItemId: "BOB-42",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        agentType: "claude",
      }),
    ).resolves.toMatchObject({
      tenantId: "tenant-1",
      status: "queued",
    });
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

    const caller = createCaller(db) as any;

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
});
