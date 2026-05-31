import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/test";

const fakeSession = {
  session: {
    id: "auth-session-1",
    createdAt: new Date("2026-05-31T00:00:00.000Z"),
    updatedAt: new Date("2026-05-31T00:00:00.000Z"),
    userId: "user-1",
    expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    token: "token-1",
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: "user-1",
    createdAt: new Date("2026-05-31T00:00:00.000Z"),
    updatedAt: new Date("2026-05-31T00:00:00.000Z"),
    email: "test@example.com",
    emailVerified: true,
    name: "Test User",
    image: null,
  },
};

let createCaller: (db: unknown) => ReturnType<any>;

const createSelectDb = (rowsBySelect: unknown[][]) => {
  const queue = [...rowsBySelect];
  const where = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    select,
    __mock: {
      from,
      where,
    },
  };
};

const createDeleteDb = (deletedRows: unknown[]) => {
  const operations: string[] = [];
  const returning = vi.fn(() => Promise.resolve(deletedRows));
  const where = vi.fn(() => ({ returning }));
  const deleteFn = vi.fn(() => {
    operations.push("delete");
    return { where };
  });
  const updateWhere = vi.fn(() => Promise.resolve());
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => {
    operations.push("update");
    return { set };
  });
  const tx = {
    delete: deleteFn,
    update,
  };

  return {
    transaction: vi.fn((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    ),
    __mock: {
      delete: deleteFn,
      operations,
      returning,
      set,
      update,
    },
  };
};

beforeAll(async () => {
  const { createTRPCRouter } = await import("../../trpc");
  const { authRouter } = await import("../auth");
  const router = createTRPCRouter({
    auth: authRouter,
  });

  createCaller = (db: unknown) =>
    router.createCaller({
      session: fakeSession,
      authApi: { getSession: vi.fn() },
      apiKeyAuth: null,
      db,
    } as any);
});

describe("auth GDPR procedures", () => {
  it("exports account data with stored credentials redacted", async () => {
    const rowsBySelect = Array.from({ length: 30 }, () => [] as unknown[]);
    rowsBySelect[0] = [{ id: "user-1", email: "test@example.com" }];
    rowsBySelect[1] = [{ id: "session-1", token: "session-token" }];
    rowsBySelect[2] = [
      {
        id: "account-1",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        idToken: "id-token",
        password: "password-hash",
      },
    ];
    rowsBySelect[4] = [{ id: "key-1", keyHash: "hashed-key" }];
    rowsBySelect[5] = [{ id: "device-code-1", apiKey: "device-api-key" }];
    rowsBySelect[17] = [
      {
        id: "cookie-1",
        valueCiphertext: "ciphertext",
        valueIv: "iv",
        valueTag: "tag",
      },
    ];
    rowsBySelect[18] = [
      {
        id: "secret-1",
        valueCiphertext: "secret-ciphertext",
        valueIv: "secret-iv",
        valueTag: "secret-tag",
      },
    ];
    rowsBySelect[19] = [
      {
        id: "git-connection-1",
        accessTokenCiphertext: "token-ciphertext",
        accessTokenIv: "token-iv",
        accessTokenTag: "token-tag",
      },
    ];
    rowsBySelect[22] = [{ id: "webhook-1", secret: "webhook-secret" }];
    rowsBySelect[27] = [{ id: "push-1", expoPushToken: "push-token" }];

    const db = createSelectDb(rowsBySelect);
    const caller = createCaller(db) as any;

    const result = await caller.auth.exportData();

    expect(result.userId).toBe("user-1");
    expect(result.data.user).toEqual([
      { id: "user-1", email: "test@example.com" },
    ]);
    expect(result.data.authAccounts[0]).toMatchObject({
      accessToken: "[redacted]",
      refreshToken: "[redacted]",
      idToken: "[redacted]",
      password: "[redacted]",
    });
    expect(result.data.authSessions[0].token).toBe("[redacted]");
    expect(result.data.apiKeys[0].keyHash).toBe("[redacted]");
    expect(result.data.deviceCodes[0].apiKey).toBe("[redacted]");
    expect(result.data.browserCookies[0]).toMatchObject({
      valueCiphertext: "[redacted]",
      valueIv: "[redacted]",
      valueTag: "[redacted]",
    });
    expect(result.data.sessionSecrets[0].valueCiphertext).toBe("[redacted]");
    expect(result.data.gitProviderConnections[0].accessTokenCiphertext).toBe(
      "[redacted]",
    );
    expect(result.data.webhookConfigs[0].secret).toBe("[redacted]");
    expect(result.data.devicePushTokens[0].expoPushToken).toBe("[redacted]");
    expect(db.select).toHaveBeenCalledTimes(30);
  });

  it("removes non-cascading references before deleting the user account", async () => {
    const db = createDeleteDb([{ id: "user-1" }]);
    const caller = createCaller(db) as any;

    await expect(caller.auth.deleteAccount()).resolves.toEqual({
      deleted: true,
      userId: "user-1",
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.__mock.operations).toEqual([
      "delete",
      "delete",
      "update",
      "delete",
    ]);
    expect(db.__mock.set).toHaveBeenCalledWith({ assigneeUserId: null });
    expect(db.__mock.returning).toHaveBeenCalledTimes(1);
  });

  it("reports a missing user when the account row is already gone", async () => {
    const db = createDeleteDb([]);
    const caller = createCaller(db) as any;

    await expect(caller.auth.deleteAccount()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
