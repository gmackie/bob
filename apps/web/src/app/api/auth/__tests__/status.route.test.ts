import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSessionMock, validateSessionTokenMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  validateSessionTokenMock: vi.fn(),
}));

vi.mock("~/auth/server", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@bob/auth", () => ({
  validateSessionToken: validateSessionTokenMock,
}));

describe("auth status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.REQUIRE_AUTH;
  });

  it("returns a local authenticated user when auth is disabled", async () => {
    const { GET } = await import("../status/route");
    const response = await GET(
      new NextRequest("https://bob.example.internal/api/auth/status"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: { id: "local", username: "local" },
    });
  });

  it("accepts an authenticated cookie session when auth is required", async () => {
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValueOnce({
      user: {
        id: "user-1",
        email: "alice@example.com",
        name: "Alice Builder",
        image: "https://example.com/alice.png",
      },
    });

    const { GET } = await import("../status/route");
    const response = await GET(
      new NextRequest("https://bob.example.internal/api/auth/status"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "user-1",
        username: "alice",
        displayName: "Alice Builder",
        email: "alice@example.com",
        avatarUrl: "https://example.com/alice.png",
      },
    });
  });

  it("validates bearer session tokens when auth is required", async () => {
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValueOnce(null);
    validateSessionTokenMock.mockResolvedValueOnce({
      session: {
        id: "auth-session-1",
      },
      user: {
        id: "user-2",
        email: "bob@example.com",
        name: "Bob Builder",
        image: null,
      },
    });

    const { GET } = await import("../status/route");
    const response = await GET(
      new NextRequest("https://bob.example.internal/api/auth/status", {
        headers: {
          Authorization: "Bearer session-token-123",
        },
      }),
    );

    expect(validateSessionTokenMock).toHaveBeenCalledWith("session-token-123");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "user-2",
        username: "bob",
        displayName: "Bob Builder",
        email: "bob@example.com",
      },
    });
  });

  it("rejects missing or invalid credentials when auth is required", async () => {
    process.env.REQUIRE_AUTH = "true";
    getSessionMock.mockResolvedValue(null);
    validateSessionTokenMock.mockResolvedValue(null);

    const { GET } = await import("../status/route");
    const response = await GET(
      new NextRequest("https://bob.example.internal/api/auth/status", {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      user: null,
    });
  });
});
