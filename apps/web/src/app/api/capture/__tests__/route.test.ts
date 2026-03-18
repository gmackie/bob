import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock getSession
const getSessionMock = vi.fn();
vi.mock("~/auth/server", () => ({
  getSession: getSessionMock,
}));

// Mock fs/promises to avoid actual file writes
vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock child_process to avoid actual screen captures
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Import after mocks are set up
const { POST } = await import("../route");

function createMockRequest(body: Record<string, unknown>): any {
  return {
    json: async () => body,
  };
}

describe("capture API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without auth (401)", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const req = createMockRequest({
      targetType: "screen",
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("accepts valid browser capture request (200)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest({
      targetType: "browser",
      url: "https://example.com",
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^\/uploads\/captures\/capture-.+\.png$/);
    expect(body.filename).toMatch(/^capture-.+\.png$/);
    expect(body.width).toBe(1280);
    expect(body.height).toBe(720);
    expect(body.capturedAt).toBeDefined();
  });

  it("accepts valid screen capture request (200)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest({
      targetType: "screen",
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^\/uploads\/captures\//);
    expect(body.capturedAt).toBeDefined();
  });

  it("accepts valid window capture request (200)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest({
      targetType: "window",
      targetId: "12345",
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^\/uploads\/captures\//);
  });
});
