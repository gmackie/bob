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

// Import after mocks are set up
const { POST } = await import("../route");

function createMockRequest(file?: {
  name: string;
  type: string;
  size: number;
  content?: ArrayBuffer;
}): any {
  const formData = new Map<string, any>();
  if (file) {
    formData.set("file", {
      name: file.name,
      type: file.type,
      size: file.size,
      arrayBuffer: async () => file.content ?? new ArrayBuffer(file.size),
    });
  }

  return {
    formData: async () => ({
      get: (key: string) => formData.get(key) ?? null,
    }),
  };
}

describe("upload API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without auth (401)", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const req = createMockRequest({
      name: "photo.png",
      type: "image/png",
      size: 1024,
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects non-image files (400)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest({
      name: "document.pdf",
      type: "application/pdf",
      size: 1024,
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Only images are supported");
  });

  it("rejects files > 10MB (400)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest({
      name: "huge.png",
      type: "image/png",
      size: 11 * 1024 * 1024,
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("File too large (max 10MB)");
  });

  it("rejects missing file (400)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest(); // no file

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("No file provided");
  });

  it("accepts valid image upload (200)", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
    });

    const req = createMockRequest({
      name: "screenshot.png",
      type: "image/png",
      size: 5000,
      content: new ArrayBuffer(5000),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^\/uploads\/chat\/.+\.png$/);
    expect(body.filename).toBe("screenshot.png");
    expect(body.mimeType).toBe("image/png");
    expect(body.sizeBytes).toBe(5000);
  });
});
