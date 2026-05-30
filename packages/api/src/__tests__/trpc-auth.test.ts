import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, resolveRequestAuthContextMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(),
  },
  resolveRequestAuthContextMock: vi.fn(),
}));

vi.mock("@bob/db", () => ({
  eq: vi.fn((field, value) => ({ field, value })),
}));

vi.mock("@bob/db/client", () => ({
  db: dbMock,
}));

vi.mock("@bob/db/schema", () => ({
  user: {
    id: "user.id",
  },
}));

vi.mock("@bob/auth", () => ({
  resolveRequestAuthContext: resolveRequestAuthContextMock,
}));

describe("createTRPCContext auth configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("requires REQUIRE_AUTH=true in production before using the default user fallback", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.REQUIRE_AUTH;

    const { createTRPCContext } = await import("../trpc");

    await expect(
      createTRPCContext({
        auth: {
          api: {
            getSession: vi.fn(),
          },
        } as any,
        headers: new Headers(),
      }),
    ).rejects.toThrow("REQUIRE_AUTH=true must be set in production");

    expect(dbMock.select).not.toHaveBeenCalled();
    expect(resolveRequestAuthContextMock).not.toHaveBeenCalled();
  });
});
