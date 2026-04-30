import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  validateApiKeyMock,
  isApiKeyMock,
  getSessionMock,
} = vi.hoisted(() => ({
  validateApiKeyMock: vi.fn(),
  isApiKeyMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("../api-key", () => ({
  isApiKey: isApiKeyMock,
  validateApiKey: validateApiKeyMock,
}));

describe("resolveAuthContext", () => {
  const defaultUser = {
    session: null,
    user: {
      id: "default-user",
      email: "default@example.com",
      name: "Default User",
      emailVerified: true,
      image: null,
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    },
  };

  const mockAuthBundle = {
    authInstance: {
      api: {
        getSession: getSessionMock,
      },
    },
    runtime: {} as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.REQUIRE_AUTH;
  });

  afterEach(() => {
    delete process.env.REQUIRE_AUTH;
  });

  it("prefers a better-auth session from the request headers", async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: "auth-session-1" },
      user: { id: "user-1" },
    });

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle as any,
      defaultUser,
      headers: new Headers(),
    });

    expect(result.authMethod).toBe("session");
    expect(result.session).toEqual({
      session: { id: "auth-session-1" },
      user: { id: "user-1" },
    });
  });

  it("returns the default user when auth is optional", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle as any,
      defaultUser,
      headers: new Headers({
        "x-workspace-id": "workspace-1",
        "x-project-id": "project-1",
      }),
    });

    expect(result.authMethod).toBe("default_user");
    expect(result.session).toEqual(defaultUser);
    expect(result.workspace).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
  });

  it("returns no auth context when auth is required and no credentials are valid", async () => {
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValueOnce(null);
    isApiKeyMock.mockReturnValueOnce(false);

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle as any,
      defaultUser: null,
      headers: new Headers({
        authorization: "Bearer bad-token",
      }),
    });

    expect(result.authMethod).toBe("none");
    expect(result.session).toBeNull();
  });
});
