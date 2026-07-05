import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthRuntimeBundle } from "../runtime";

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

  // The test only ever calls `authBundle.authInstance.api.getSession(...)` —
  // `runtime` (an Effect `ManagedRuntime`) is never exercised by
  // `resolveAuthContext`, so it's safe to stub. We go through `unknown` (not
  // `any`) because the real `AuthRuntimeBundle` shape is fully known but
  // impractical to construct in a unit test; the cast is scoped to this one
  // fixture rather than sprinkled at each call site.
  const mockAuthBundle = {
    authInstance: {
      api: {
        getSession: getSessionMock,
      },
    },
    runtime: {},
  } as unknown as AuthRuntimeBundle;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.BOB_AUTH_BYPASS;
    delete process.env.BOB_AUTH_BYPASS_TOKEN;
    delete process.env.BOB_AUTH_BYPASS_USER_ID;
    delete process.env.REQUIRE_AUTH;
  });

  afterEach(() => {
    delete process.env.BOB_AUTH_BYPASS;
    delete process.env.BOB_AUTH_BYPASS_TOKEN;
    delete process.env.BOB_AUTH_BYPASS_USER_ID;
    delete process.env.REQUIRE_AUTH;
  });

  it("prefers a better-auth session from the request headers", async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { id: "auth-session-1" },
      user: { id: "user-1" },
    });

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle,
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
      authBundle: mockAuthBundle,
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
      authBundle: mockAuthBundle,
      defaultUser: null,
      headers: new Headers({
        authorization: "Bearer bad-token",
      }),
    });

    expect(result.authMethod).toBe("none");
    expect(result.session).toBeNull();
  });

  it("accepts the configured auth bypass user even when normal auth is required", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.BOB_AUTH_BYPASS_TOKEN = "prod-secret";
    process.env.BOB_AUTH_BYPASS_USER_ID = "default-user";
    process.env.REQUIRE_AUTH = "true";
    isApiKeyMock.mockReturnValueOnce(false);

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle,
      defaultUser,
      headers: new Headers({
        cookie: "bob-auth-bypass:prod-secret",
      }),
    });

    expect(result.authMethod).toBe("default_user");
    expect(result.session).toEqual(defaultUser);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("rejects auth bypass tokens that do not match the configured secret", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.BOB_AUTH_BYPASS_TOKEN = "prod-secret";
    process.env.BOB_AUTH_BYPASS_USER_ID = "default-user";
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValueOnce(null);
    isApiKeyMock.mockReturnValueOnce(false);

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle,
      defaultUser,
      headers: new Headers({
        cookie: "bob-auth-bypass:wrong-secret",
      }),
    });

    expect(result.authMethod).toBe("none");
    expect(result.session).toBeNull();
  });

  it("rejects auth bypass tokens when no backend secret is configured", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValueOnce(null);
    isApiKeyMock.mockReturnValueOnce(false);

    const { resolveAuthContext } = await import("../context");
    const result = await resolveAuthContext({
      authBundle: mockAuthBundle,
      defaultUser,
      headers: new Headers({
        cookie: "bob-auth-bypass:prod-secret",
      }),
    });

    expect(result.authMethod).toBe("none");
    expect(result.session).toBeNull();
  });
});
