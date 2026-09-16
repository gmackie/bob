import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn() }));
vi.mock("~/lib/rest/api-helpers", () => ({
  createPublicApiCaller: async () => ({
    publicApi: { getRunTraceResource: mocks.get },
  }),
  withApiRateLimit: (_request: Request, fn: () => Promise<Response>) => fn(),
  errorResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("~/lib/traces/run-trace-status", () => ({
  getRunTraceStatuses: mocks.lookup,
}));
import { GET } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FG_API_TOKEN", "server-token");
});
describe("API key run trace status", () => {
  it("enforces the read and workspace authorized procedure before storage lookup", async () => {
    mocks.get.mockResolvedValue({ sessionId: "owned", artifacts: [] });
    mocks.lookup.mockResolvedValue([]);
    const response = await GET(new Request("https://bob.example"), {
      params: Promise.resolve({ runId: "run" }),
    });
    expect(mocks.get).toHaveBeenCalledWith({ runId: "run" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ traces: [] });
  });
  it("never queries telemetry on an authorization denial", async () => {
    mocks.get.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await GET(new Request("https://bob.example"), {
      params: Promise.resolve({ runId: "other" }),
    });
    expect(response.status).toBe(403);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
