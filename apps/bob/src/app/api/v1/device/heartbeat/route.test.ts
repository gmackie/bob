import { beforeEach, describe, expect, it, vi } from "vitest";

const validateApiKeyMock = vi.fn();
const getSessionMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@bob/auth", () => ({
  validateApiKey: validateApiKeyMock,
}));

vi.mock("@bob/db/client", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("~/auth/server", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

describe("device heartbeat route", () => {
  beforeEach(() => {
    validateApiKeyMock.mockReset();
    getSessionMock.mockReset();
    selectMock.mockReset();
  });

  it("rejects requests without a bearer API key", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://bob.example.com/api/v1/device/heartbeat"),
    );

    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(response.status).toBe(401);
  });

  it("returns the authenticated user's selected session", async () => {
    validateApiKeyMock.mockResolvedValue({
      userId: "user-1",
      permissions: ["read", "write"],
    });
    mockSessionRows([
      {
        id: "session-1",
        title: "Whisplay test session",
        agentType: "codex",
        status: "running",
        lastActivityAt: "2026-06-08T12:00:00.000Z",
        updatedAt: "2026-06-08T12:00:00.000Z",
      },
    ]);

    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://bob.example.com/api/v1/device/heartbeat", {
        headers: {
          authorization: "Bearer bob_test_key",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      selectedSession: {
        id: "session-1",
        title: "Whisplay test session",
        agentType: "codex",
        status: "running",
      },
    });
    expect(validateApiKeyMock).toHaveBeenCalledWith("bob_test_key");
  });

  it("accepts a browser cookie session when no bearer key is present", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user-from-cookie" },
      session: { id: "session-cookie" },
    });
    mockSessionRows([
      {
        id: "session-2",
        title: "Chrome cookie session",
        agentType: "codex",
        status: "running",
        lastActivityAt: "2026-06-08T12:00:00.000Z",
        updatedAt: "2026-06-08T12:00:00.000Z",
      },
    ]);

    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://bob.example.com/api/v1/device/heartbeat", {
        headers: {
          cookie: "__Secure-better-auth.session_token=browser-session",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      selectedSession: {
        id: "session-2",
        title: "Chrome cookie session",
      },
    });
    expect(getSessionMock).toHaveBeenCalled();
  });
});

function mockSessionRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValue({ from });
}
