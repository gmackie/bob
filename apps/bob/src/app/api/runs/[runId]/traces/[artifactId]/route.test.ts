import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("~/lib/planning/server", () => ({
  createPlanningCaller: async () => ({ agentRun: { get: mocks.get } }),
}));
import { GET } from "./route";
const params = Promise.resolve({ runId: "run-1", artifactId: "artifact-1" });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FORGEGRAPH_TRACE_VIEWER_URL", "https://trace.forgegraf.com");
});
describe("owned run trace link", () => {
  it("ignores persisted URLs and redirects only to the configured viewer", async () => {
    mocks.get.mockResolvedValue({
      artifacts: [
        {
          id: "artifact-1",
          metadata: {
            kind: "trace_reference",
            traceId: "1".repeat(32),
            viewerUrl: "https://attacker.example/secret",
          },
        },
      ],
    });
    const response = await GET(new Request("https://bob.example"), { params });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://trace.forgegraf.com/trace/${"1".repeat(32)}`,
    );
    expect(mocks.get).toHaveBeenCalledWith({ runId: "run-1" });
  });
  it("does not redirect when run authorization fails", async () => {
    mocks.get.mockRejectedValue(new Error("NOT_FOUND"));
    const response = await GET(new Request("https://bob.example"), { params });
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
