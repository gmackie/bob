import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  validateApiKeyMock,
  isApiKeyMock,
  validateSessionTokenMock,
  getSessionMock,
} = vi.hoisted(() => ({
  validateApiKeyMock: vi.fn(),
  isApiKeyMock: vi.fn(),
  validateSessionTokenMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("../api-key", () => ({
  isApiKey: isApiKeyMock,
  validateApiKey: validateApiKeyMock,
}));

vi.mock("../session", () => ({
  validateSessionToken: validateSessionTokenMock,
}));

describe("resolveRequestAuthContext", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const restoreNodeEnv = () => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  };
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.REQUIRE_AUTH;
    restoreNodeEnv();
  });

  afterEach(() => {
    delete process.env.REQUIRE_AUTH;
    restoreNodeEnv();
  });

  it("prefers a better-auth session from the request headers", async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: "auth-session-1" },
      user: { id: "user-1" },
    });

    const { resolveRequestAuthContext } = await import("../context");
    const result = await resolveRequestAuthContext({
      auth: {
        api: {
          getSession: getSessionMock,
        },
      } as any,
      defaultUser,
      headers: new Headers(),
    });

    expect(result.authMethod).toBe("session");
    expect(result.session).toEqual({
      session: { id: "auth-session-1" },
      user: { id: "user-1" },
    });
  });

  it("falls back to bearer token validation for non-cookie session tokens", async () => {
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValueOnce(null);
    isApiKeyMock.mockReturnValueOnce(false);
    validateSessionTokenMock.mockResolvedValueOnce({
      session: { id: "auth-session-2" },
      user: { id: "user-2" },
    });

    const { resolveRequestAuthContext } = await import("../context");
    const result = await resolveRequestAuthContext({
      auth: {
        api: {
          getSession: getSessionMock,
        },
      } as any,
      defaultUser,
      headers: new Headers({
        authorization: "Bearer session-token-123",
      }),
    });

    expect(validateSessionTokenMock).toHaveBeenCalledWith("session-token-123");
    expect(result.authMethod).toBe("session");
    expect(result.session).toEqual({
      session: { id: "auth-session-2" },
      user: { id: "user-2" },
    });
  });

  it("returns the default user when auth is optional", async () => {
    process.env.NODE_ENV = "development";
    process.env.REQUIRE_AUTH = "false";
    getSessionMock.mockResolvedValueOnce(null);

    const { resolveRequestAuthContext } = await import("../context");
    const result = await resolveRequestAuthContext({
      auth: {
        api: {
          getSession: getSessionMock,
        },
      } as any,
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
    validateSessionTokenMock.mockResolvedValueOnce(null);

    const { resolveRequestAuthContext } = await import("../context");
    const result = await resolveRequestAuthContext({
      auth: {
        api: {
          getSession: getSessionMock,
        },
      } as any,
      defaultUser: null,
      headers: new Headers({
        authorization: "Bearer bad-token",
      }),
    });

    expect(result.authMethod).toBe("none");
    expect(result.session).toBeNull();
  });

  it("does not use the default user in production when auth mode is unset", async () => {
    process.env.NODE_ENV = "production";
    getSessionMock.mockResolvedValueOnce(null);

    const { resolveRequestAuthContext } = await import("../context");
    const result = await resolveRequestAuthContext({
      auth: {
        api: {
          getSession: getSessionMock,
        },
      } as any,
      defaultUser,
      headers: new Headers(),
    });

    expect(result.authMethod).toBe("none");
    expect(result.session).toBeNull();
  });
});
