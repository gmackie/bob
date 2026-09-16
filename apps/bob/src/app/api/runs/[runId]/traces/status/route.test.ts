import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn() }));
vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: async () => ({ agentRun: { get: mocks.get } }),
}));
vi.mock("~/lib/traces/run-trace-status", () => ({
  getRunTraceStatuses: mocks.lookup,
}));
import { GET } from "./route";
const params = Promise.resolve({ runId: "run" });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FG_API_TOKEN", "private-token");
});
describe("run trace storage status", () => {
  it("authorizes the run before querying and returns private no-store data", async () => {
    const run = { sessionId: "owned", artifacts: [] };
    mocks.get.mockResolvedValue(run);
    mocks.lookup.mockResolvedValue([{ artifactId: "a", state: "stored" }]);
    const response = await GET(
      new Request("https://bob.example/api/runs/run/traces/status"),
      { params },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      traces: [{ artifactId: "a", state: "stored" }],
    });
    expect(mocks.lookup).toHaveBeenCalledWith(run, {
      baseUrl: "https://forgegraf.com",
      token: "private-token",
    });
  });
  it("never queries storage for another user's run or an unauthenticated request", async () => {
    mocks.get.mockRejectedValue(new Error("NOT_FOUND"));
    const response = await GET(new Request("https://bob.example"), { params });
    expect(response.status).toBe(404);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
