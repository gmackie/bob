import { describe, expect, it, vi } from "vitest";

import { createPreflightClient } from "../preflight-client";

const app = {
  id: "pfapp_ooda_handheld_mobile",
  workspaceId: "workspace-1",
  appRuntime: "expo",
  displayName: "OODA Handheld",
  packageName: "@ooda-handheld/mobile",
  packagePath: "apps/mobile",
  iosBundleId: "com.gmacko.ooda-handheld",
  defaultDistributionIntent: "internal_only",
  createdAt: "2026-08-09T15:00:00.000Z",
  updatedAt: "2026-08-09T15:00:00.000Z",
} as const;

describe("createPreflightClient", () => {
  it("uses the workspace app registry and canonical release-status routes", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const data = url.includes("release-status")
          ? {
              releaseStatus: {
                app: { id: app.id, platforms: ["ios"] },
                platform: "ios",
                stage: { current: "identity", next: null },
                latestBuilds: [],
                submissions: [],
              },
            }
          : init?.method === "POST"
            ? { app }
            : { apps: [app] };
        return new Response(JSON.stringify({ data, meta: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const client = createPreflightClient({
      apiUrl: "https://preflight.example/",
      apiToken: "gmk_preflight_key",
      fetch: fetcher,
    });

    await expect(client.listApps("workspace-1")).resolves.toEqual([app]);
    await expect(client.upsertApp(app)).resolves.toEqual(app);
    await expect(
      client.readReleaseStatus(app.id, "ios"),
    ).resolves.toMatchObject({ platform: "ios" });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain(
      "/api/preflight/v1/apps?workspaceId=workspace-1",
    );
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain(
      "/api/preflight/v1/apps",
    );
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetcher.mock.calls[2]?.[0].toString()).toContain(
      `/api/preflight/v1/apps/${app.id}/release-status?platform=ios`,
    );
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer gmk_preflight_key",
      );
    }
  });

  it("returns null for Preflight's validation-coded missing-app response", async () => {
    const client = createPreflightClient({
      apiUrl: "https://preflight.example",
      apiToken: "gmk_preflight_key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "app_not_found",
              category: "validation",
              message: "Preflight app was not found.",
            },
            meta: {},
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      client.readReleaseStatus("pfapp_missing", "ios"),
    ).resolves.toBeNull();
  });
});
