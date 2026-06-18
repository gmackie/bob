import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiKeyFindFirstMock, userFindFirstMock } = vi.hoisted(() => ({
  apiKeyFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
}));

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      apiKeys: {
        findFirst: apiKeyFindFirstMock,
      },
      user: {
        findFirst: userFindFirstMock,
      },
    },
  },
}));

describe("validateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes revokedAt in the API key lookup guard", async () => {
    const { hashApiKey, validateApiKey } = await import("../api-key");

    apiKeyFindFirstMock.mockImplementationOnce(({ where }) => {
      const and = vi.fn((...clauses) => clauses);
      const eq = vi.fn((left, right) => ({ type: "eq", left, right }));
      const isNull = vi.fn((value) => ({ type: "isNull", value }));
      const table = {
        keyHash: "keyHashColumn",
        revokedAt: "revokedAtColumn",
      };

      where(table, { and, eq, isNull });

      expect(eq).toHaveBeenCalledWith("keyHashColumn", hashApiKey("bob_live_key"));
      expect(isNull).toHaveBeenCalledWith("revokedAtColumn");

      return Promise.resolve(null);
    });

    await expect(validateApiKey("bob_live_key")).resolves.toBeNull();
    expect(userFindFirstMock).not.toHaveBeenCalled();
  });
});
