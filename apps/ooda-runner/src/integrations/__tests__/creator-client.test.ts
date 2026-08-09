import { describe, expect, it, vi } from "vitest";

import { createCreatorClient } from "../creator-client";

const row = {
  id: "project-1",
  manifestId: "voice-ooda",
  sourceKind: "local",
  sourcePath: "/Volumes/dev/video-projects/voice-ooda",
  title: "Voice OODA",
  status: "idea",
  createdAt: "2026-08-09T12:00:00.000Z",
};

describe("createCreatorClient", () => {
  it("uses Creator's video tRPC procedures with API-key authentication", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const data = url.includes("video.list") ? [row] : row;
        return new Response(
          JSON.stringify({ result: { data: { json: data } } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    const client = createCreatorClient({
      apiUrl: "https://creator.example/",
      apiKey: "gmk_creator_key",
      fetch: fetcher,
    });

    await expect(client.listProjects()).resolves.toEqual([row]);
    await expect(
      client.registerLocalProject("/Volumes/dev/video-projects/voice-ooda"),
    ).resolves.toEqual(row);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain("video.list");
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain("video.register");
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer gmk_creator_key",
      );
    }
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain(
      "/Volumes/dev/video-projects/voice-ooda",
    );
  });
});
