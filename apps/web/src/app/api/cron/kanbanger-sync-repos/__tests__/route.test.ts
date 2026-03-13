import { beforeEach, describe, expect, it, vi } from "vitest";

const syncPlanningReposForBobUser = vi.fn();

vi.mock("~/server/planning/sync-repos", () => ({
  syncPlanningReposForBobUser,
}));

describe("cron planning repo sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.PLANNING_API_KEY = "planning-api-key";
    delete process.env.KANBANGER_API_KEY;
  });

  it("accepts planning api key aliases when invoking the sync route", async () => {
    syncPlanningReposForBobUser.mockResolvedValueOnce({
      synced: 2,
      skipped: 0,
    });

    const { GET } = await import("../route");

    const response = await GET(
      new Request(
        "https://bob.example.internal/api/cron/kanbanger-sync-repos?workspaceId=workspace-123",
        {
          headers: {
            authorization: "Bearer cron-secret",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      synced: 2,
      skipped: 0,
    });
    expect(syncPlanningReposForBobUser).toHaveBeenCalledWith({
      workspaceId: "workspace-123",
      userId: null,
    });
  });
});
