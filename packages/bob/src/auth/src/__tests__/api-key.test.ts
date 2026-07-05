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

// Minimal structural stand-in for the slice of drizzle's relational
// query-builder `where` callback that `validateApiKey` actually calls:
// `(table, { and, eq, isNull }) => and(eq(table.keyHash, hash), isNull(table.revokedAt))`.
// We don't import drizzle's real (deeply generic) callback type here since
// this test only needs to observe which column refs + values the production
// code passes through — the mock's job is to capture those calls, not to
// re-implement drizzle's query builder.
interface MockApiKeyTable {
  keyHash: string;
  revokedAt: string;
}
interface MockWhereOps {
  and: (...clauses: unknown[]) => unknown[];
  eq: (left: unknown, right: unknown) => { type: "eq"; left: unknown; right: unknown };
  isNull: (value: unknown) => { type: "isNull"; value: unknown };
}
type MockWhereCallback = (
  table: MockApiKeyTable,
  ops: MockWhereOps,
) => unknown;

describe("validateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes revokedAt in the API key lookup guard", async () => {
    const { hashApiKey, validateApiKey } = await import("../api-key");

    apiKeyFindFirstMock.mockImplementationOnce(
      ({ where }: { where: MockWhereCallback }) => {
        const and = vi.fn((...clauses: unknown[]) => clauses);
        const eq = vi.fn((left: unknown, right: unknown) => ({
          type: "eq" as const,
          left,
          right,
        }));
        const isNull = vi.fn((value: unknown) => ({
          type: "isNull" as const,
          value,
        }));
        const table: MockApiKeyTable = {
          keyHash: "keyHashColumn",
          revokedAt: "revokedAtColumn",
        };

        where(table, { and, eq, isNull });

        expect(eq).toHaveBeenCalledWith("keyHashColumn", hashApiKey("bob_live_key"));
        expect(isNull).toHaveBeenCalledWith("revokedAtColumn");

        return Promise.resolve(null);
      },
    );

    await expect(validateApiKey("bob_live_key")).resolves.toBeNull();
    expect(userFindFirstMock).not.toHaveBeenCalled();
  });
});
